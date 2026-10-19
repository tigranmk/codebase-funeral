import type { Commit } from "./git.js";

export interface Mourner {
  name: string;
  commits: number;
  added: number;
  deleted: number;
  first: Date;
  last: Date;
}

export interface Oddity {
  label: string;
  commit: Commit;
  detail: string;
}

export interface Stats {
  name: string;
  born: Date;
  died: Date;
  lifespanDays: number;
  totalCommits: number;
  linesWritten: number;
  linesDeleted: number;
  mourners: Mourner[];
  founders: string[];
  lastToLeave: string[];
  firstWords: string;
  lastWords: string;
  oddities: Oddity[];
  elder: { path: string; since: Date } | null;
  causeOfDeath: string;
  /** Commits per month, oldest first — for the timeline. */
  monthly: { month: string; count: number }[];
}

const DAY = 86_400_000;

export function computeStats(name: string, commits: Commit[], tracked: Set<string>): Stats {
  if (commits.length === 0) throw new Error("This repository has no commits. It was never born.");

  // Author dates survive rebases and cherry-picks, so history order isn't date order: take the extremes.
  // (A loop, not Math.min(...xs): spreading a huge history overflows the call stack.)
  let born = commits[0].date;
  let died = commits[0].date;
  for (const c of commits) {
    if (c.date < born) born = c.date;
    if (c.date > died) died = c.date;
  }

  const byAuthor = new Map<string, Mourner>();
  let linesWritten = 0;
  let linesDeleted = 0;
  for (const c of commits) {
    const added = c.files.reduce((s, f) => s + f.added, 0);
    const deleted = c.files.reduce((s, f) => s + f.deleted, 0);
    linesWritten += added;
    linesDeleted += deleted;
    const m = byAuthor.get(c.author) ?? {
      name: c.author, commits: 0, added: 0, deleted: 0, first: c.date, last: c.date,
    };
    m.commits++;
    m.added += added;
    m.deleted += deleted;
    if (c.date < m.first) m.first = c.date;
    if (c.date > m.last) m.last = c.date;
    byAuthor.set(c.author, m);
  }
  const mourners = [...byAuthor.values()].sort((a, b) => b.commits - a.commits);

  // Founders: active in the first 10% of the lifespan. Last to leave: the final 10%.
  const span = died.getTime() - born.getTime();
  const edge = Math.max(span * 0.1, 7 * DAY);
  const founders = mourners.filter((m) => m.first.getTime() - born.getTime() <= edge).map((m) => m.name);
  const lastToLeave = mourners.filter((m) => died.getTime() - m.last.getTime() <= edge).map((m) => m.name);

  return {
    name,
    born,
    died,
    lifespanDays: Math.max(1, Math.round(span / DAY)),
    totalCommits: commits.length,
    linesWritten,
    linesDeleted,
    mourners,
    founders,
    lastToLeave,
    firstWords: commits[0].subject,
    lastWords: commits[commits.length - 1].subject,
    oddities: findOddities(commits),
    elder: findElder(commits, tracked),
    causeOfDeath: diagnose(commits, born, died),
    monthly: monthly(commits, born, died),
  };
}

function findOddities(commits: Commit[]): Oddity[] {
  const out: Oddity[] = [];

  const biggestPurge = maxBy(commits, (c) => c.files.reduce((s, f) => s + f.deleted, 0));
  const purged = biggestPurge.files.reduce((s, f) => s + f.deleted, 0);
  if (purged > 0) {
    out.push({ label: "The Great Purge", commit: biggestPurge, detail: `${purged.toLocaleString()} lines deleted in one breath` });
  }

  // The author's own clock, not the clock of whoever runs this tool.
  const witching = commits.find((c) => {
    const h = Number(c.localTime.slice(0, 2));
    return h >= 2 && h < 5;
  });
  if (witching) {
    out.push({ label: "Written at the Witching Hour", commit: witching, detail: `committed at ${witching.localTime}` });
  }

  const desperate = commits.find((c) => /\b(fix\b\W*){2,}|\bplease\b|\bwhy\b|\bfinally\b|\bwtf\b|\bhack\b/i.test(c.subject));
  if (desperate) {
    out.push({ label: "A Cry for Help", commit: desperate, detail: "the commit message says it all" });
  }

  const tiniest = commits.find((c) => c.subject.trim().length <= 3);
  if (tiniest) {
    out.push({ label: "Fewest Words", commit: tiniest, detail: `"${tiniest.subject}" — and nothing more` });
  }

  return out;
}

/** The oldest file still at HEAD that was never touched after its birth. */
function findElder(commits: Commit[], tracked: Set<string>): { path: string; since: Date } | null {
  const born = new Map<string, Date>();
  const touched = new Set<string>();
  for (const c of commits) {
    for (const f of c.files) {
      // A file moved here was changed, even if its contents weren't.
      if (born.has(f.path) || f.renamed) touched.add(f.path);
      if (!born.has(f.path)) born.set(f.path, c.date);
    }
  }
  let elder: { path: string; since: Date } | null = null;
  for (const [path, since] of born) {
    if (!tracked.has(path) || touched.has(path)) continue;
    if (!elder || since < elder.since) elder = { path, since };
  }
  return elder;
}

function diagnose(commits: Commit[], bornAt: Date, diedAt: Date): string {
  const last = commits.slice(-10);
  const subjects = last.map((c) => c.subject.toLowerCase());

  if (subjects.some((s) => /archiv|deprecat|unmaintained|sunset/.test(s))) {
    return "Formally laid to rest by its maintainers";
  }
  if (subjects.filter((s) => /bump|dependabot|renovate|deps|upgrade/.test(s)).length >= last.length / 2) {
    return "Kept alive on dependency bumps alone, until even those stopped";
  }

  // Compare activity in the final quarter of life against the first three quarters.
  const born = bornAt.getTime();
  const span = diedAt.getTime() - born || 1;
  const lateShare = commits.filter((c) => (c.date.getTime() - born) / span > 0.75).length / commits.length;
  if (lateShare > 0.4) return "Sudden death at the height of its powers";
  if (lateShare < 0.1) return "A long, quiet fading";
  return "Natural causes: the team simply moved on";
}

function monthly(commits: Commit[], first: Date, last: Date): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  // Pre-fill every month so silent stretches show as gaps, and the map stays in date order.
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d.setMonth(d.getMonth() + 1)) {
    counts.set(monthKey(d), 0);
  }
  for (const c of commits) counts.set(monthKey(c.date), (counts.get(monthKey(c.date)) ?? 0) + 1);
  return [...counts].map(([month, count]) => ({ month, count }));
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function maxBy<T>(xs: T[], f: (x: T) => number): T {
  return xs.reduce((best, x) => (f(x) > f(best) ? x : best));
}
