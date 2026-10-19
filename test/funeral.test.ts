import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readCommits, renamedTo, repoName, trackedFiles } from "../src/git.js";
import { computeStats } from "../src/stats.js";
import { plural, templateEulogy } from "../src/eulogy.js";

const root = mkdtempSync(join(tmpdir(), "funeral-test-"));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function repo(): string {
  const dir = join(root, `r${n++}`);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  return dir;
}

function git(dir: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x", ...env },
  });
}

/** Write files (path → content) and commit them with the given author date. */
function commit(dir: string, msg: string, date: string, files: Record<string, string> = { [`f${n++}`]: "x" }, author = "A"): void {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", msg], { GIT_AUTHOR_DATE: date, GIT_AUTHOR_NAME: author });
}

async function statsOf(dir: string) {
  return computeStats(repoName(dir), await readCommits(dir), trackedFiles(dir));
}

describe("dates", () => {
  test("out-of-order author dates (rebases) still give a forward lifespan and a sorted timeline", async () => {
    const r = repo();
    commit(r, "first", "2024-01-01T12:00:00Z");
    commit(r, "second", "2024-06-01T12:00:00Z");
    commit(r, "rebased, old author date", "2023-01-01T12:00:00Z");
    const s = await statsOf(r);
    assert.equal(s.born.toISOString(), "2023-01-01T12:00:00.000Z");
    assert.equal(s.died.toISOString(), "2024-06-01T12:00:00.000Z");
    assert.equal(s.lifespanDays, 517);
    const months = s.monthly.map((m) => m.month);
    assert.deepEqual(months, [...months].sort());
    assert.equal(months.length, 18);
    // First and last words still follow history order, not date order.
    assert.equal(s.firstWords, "first");
    assert.equal(s.lastWords, "rebased, old author date");
    assert.equal(s.mourners[0].first.toISOString(), "2023-01-01T12:00:00.000Z");
  });

  test("witching hour uses the author's clock, whatever timezone runs the tool", async () => {
    const r = repo();
    commit(r, "noon in Tokyo, 03:00 UTC", "2024-06-01T12:00:00+09:00");
    commit(r, "late night in Tokyo", "2024-06-02T03:30:00+09:00");
    const s = await statsOf(r);
    const w = s.oddities.find((o) => o.label === "Written at the Witching Hour");
    assert.equal(w?.commit.subject, "late night in Tokyo");
    assert.equal(w?.detail, "committed at 03:30");
  });
});

describe("files", () => {
  test("the elder is found when run on a subdirectory", async () => {
    const r = repo();
    commit(r, "init", "2024-01-01T12:00:00Z", { "sub/keep.txt": "a", "other.txt": "b" });
    commit(r, "touch other", "2024-02-01T12:00:00Z", { "other.txt": "c" });
    const s = await statsOf(join(r, "sub"));
    assert.equal(s.elder?.path, "sub/keep.txt");
  });

  test("renames resolve to the new path and aren't counted as rewritten lines", async () => {
    const r = repo();
    commit(r, "init", "2024-01-01T12:00:00Z", { "old.txt": "a\nb\nc\n", "dir/x/f.txt": "1\n2\n3\n", "y.txt": "y\n" });
    git(r, ["mv", "old.txt", "new.txt"]);
    git(r, ["mv", "dir/x", "dir/z"]);
    git(r, ["commit", "-qm", "rename"], { GIT_AUTHOR_DATE: "2024-02-01T12:00:00Z" });
    const commits = await readCommits(r);
    const moved = commits[1].files;
    assert.deepEqual(moved.map((f) => f.path).sort(), ["dir/z/f.txt", "new.txt"]);
    assert.ok(moved.every((f) => f.renamed && f.added === 0 && f.deleted === 0));
    // The moved files count as changed, so the untouched elder is the one that stayed put.
    const s = await statsOf(r);
    assert.equal(s.linesWritten, 7);
    assert.equal(s.elder?.path, "y.txt");
  });

  test("renamedTo handles every numstat rename form", () => {
    assert.equal(renamedTo("a.txt"), "a.txt");
    assert.equal(renamedTo("old.txt => new.txt"), "new.txt");
    assert.equal(renamedTo("src/{a.ts => b.ts}"), "src/b.ts");
    assert.equal(renamedTo("{lib => src}/util/x.ts"), "src/util/x.ts");
    assert.equal(renamedTo("src/{ => nested}/x.ts"), "src/nested/x.ts");
    assert.equal(renamedTo("src/{nested => }/x.ts"), "src/x.ts");
    assert.equal(renamedTo("{nested => }/x.ts"), "x.ts");
  });

  test("non-ASCII paths are not C-quoted", async () => {
    const r = repo();
    commit(r, "init", "2024-01-01T12:00:00Z", { "café.txt": "a" });
    const s = await statsOf(r);
    assert.equal(s.elder?.path, "café.txt");
    assert.ok(trackedFiles(r).has("café.txt"));
  });

  test("a repo with no commits is reported, not crashed on", async () => {
    const r = repo();
    assert.deepEqual(await readCommits(r), []);
    assert.equal(trackedFiles(r).size, 0);
    await assert.rejects(statsOf(r), /never born/);
  });
});

describe("bare repositories", () => {
  test("are named after their directory and fully read", async () => {
    const r = repo();
    commit(r, "init", "2024-01-01T12:00:00Z", { "a.txt": "a" });
    const bare = join(root, "mirror.git");
    execFileSync("git", ["clone", "-q", "--bare", r, bare]);
    assert.equal(repoName(bare), "mirror");
    const s = await statsOf(bare);
    assert.equal(s.totalCommits, 1);
    assert.equal(s.elder?.path, "a.txt");
  });
});

describe("oddities", () => {
  test("'fix fix' at the end of a subject is a cry for help", async () => {
    const r = repo();
    commit(r, "something normal", "2024-01-01T12:00:00Z");
    commit(r, "fix fix", "2024-01-02T12:00:00Z");
    const s = await statsOf(r);
    assert.equal(s.oddities.find((o) => o.label === "A Cry for Help")?.commit.subject, "fix fix");
  });
});

describe("wording", () => {
  test("plural", () => {
    assert.equal(plural(1, "day"), "1 day");
    assert.equal(plural(2, "day"), "2 days");
    assert.equal(plural(1.5, "year"), "1.5 years");
  });

  test("template eulogy says 1 year, not 1.0 years", async () => {
    const r = repo();
    commit(r, "born", "2023-01-01T12:00:00Z");
    commit(r, "died", "2024-01-01T12:00:00Z");
    const e = templateEulogy(await statsOf(r));
    assert.match(e.opening, /lived for 1 year and/);
  });
});

describe("cli", () => {
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", join(import.meta.dirname, "../src/cli.ts"), ...args], {
      encoding: "utf8",
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });

  test("--version prints the package version", () => {
    const res = cli(["--version"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^\d+\.\d+\.\d+/);
  });

  test("failures exit 1 with one line, not a stack trace", () => {
    const r = repo();
    commit(r, "init", "2024-01-01T12:00:00Z");
    for (const args of [
      [join(root, "nope")],
      [r, "--no-ai", "-o", join(root, "missing-dir", "x.html")],
      [r, "--no-ai", "-e", "@" + join(root, "missing.txt")],
    ]) {
      const res = cli(args);
      assert.equal(res.status, 1, args.join(" "));
      assert.doesNotMatch(res.stderr, /\n\s+at /, res.stderr);
    }
  });

  test("bare repo end to end, with a cause ending in '!' and an @@ eulogy", () => {
    const r = repo();
    commit(r, "init", "2024-01-01T12:00:00Z");
    const bare = join(root, "e2e.git");
    execFileSync("git", ["clone", "-q", "--bare", r, bare]);
    const out = join(root, "e2e.html");
    const res = cli([bare, "-o", out, "-c", "It pivoted!", "-e", "@@handle was its name"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Here lies .*e2e.*It pivoted!(?!\.)/);
    assert.match(res.stderr, /No ANTHROPIC_API_KEY set/);
    const html = execFileSync("cat", [out], { encoding: "utf8" });
    assert.match(html, /<p>@handle was its name<\/p>/);
    assert.match(html, /<b>1<\/b><span>day lived</);
  });
});
