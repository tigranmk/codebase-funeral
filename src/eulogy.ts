import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Stats } from "./stats.js";

// Each part is only requested from Claude when the user didn't supply it on the command line.
const Fields = {
  epitaph: z.string().describe("One line for the headstone, under 12 words"),
  opening: z.string().describe("The opening of the eulogy, 2-3 short paragraphs separated by blank lines"),
  survivedBy: z.string().describe("A 'survived by' paragraph naming the contributors and what each gave"),
  closing: z.string().describe("A short closing farewell, 1 paragraph"),
  cause: z
    .string()
    .describe("The most likely cause of death, under 12 words, inferred only from the facts. The heuristic guess is a hint, not an answer."),
  remembrance: z
    .string()
    .describe("One paragraph on what the project will be remembered for, drawn only from its history. Do not attribute quotes to anyone."),
};

export interface Eulogy {
  epitaph: string;
  opening: string;
  /** Empty when the user wrote the whole speech. */
  survivedBy: string;
  closing: string;
  cause?: string;
  remembrance?: string;
}

/** What the user told us on the command line. Every part is optional. */
export interface Tribute {
  cause?: string;
  memories: string[];
  /** The whole speech, replacing the opening, survived-by and farewell. */
  eulogy?: string;
  epitaph?: string;
}

/** The parts the user wrote, which take precedence over anything generated. */
export function userParts(t: Tribute): Partial<Eulogy> {
  return {
    ...(t.epitaph && { epitaph: t.epitaph }),
    ...(t.eulogy && { opening: t.eulogy, survivedBy: "", closing: "" }),
  };
}

/** The parts Claude still has to write; empty means there's no need to call it. */
export function missingParts(t: Tribute): (keyof typeof Fields)[] {
  return [
    ...(t.epitaph ? [] : (["epitaph"] as const)),
    ...(t.eulogy ? [] : (["opening", "survivedBy", "closing"] as const)),
    ...(t.cause ? [] : (["cause"] as const)),
    ...(t.memories.length ? [] : (["remembrance"] as const)),
  ];
}

export const DEFAULT_MODEL = "claude-opus-5-5";

const SYSTEM = `You write eulogies for software repositories that have been archived or abandoned.
Tone: warm, wry, and sincere, like a eulogy from a friend who knew the deceased's flaws and loved it anyway.
Ground every line in the facts you are given; never invent features, users, or events.
Humor comes from the real details (commit messages, odd hours, the final words), never from mocking the people involved.
Plain prose, no markdown.`;

export async function writeEulogy(stats: Stats, tribute: Tribute, model: string): Promise<Partial<Eulogy>> {
  const schema = z.object(Object.fromEntries(missingParts(tribute).map((k) => [k, Fields[k]])));
  // The SDK default (10 minutes, 2 retries) would leave the CLI hanging on a stalled network.
  const client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model,
    // On a safety-classifier decline, the API reruns the request on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_tokens: 10000,
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Write the eulogy for this repository.\n\n${factSheet(stats, tribute)}` }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`model returned no eulogy (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output as Partial<Eulogy>;
}

/** Deterministic eulogy for --no-ai, or when the API is unavailable. */
export function templateEulogy(s: Stats): Eulogy {
  const years = s.lifespanDays >= 365 ? plural(Number((s.lifespanDays / 365).toFixed(1)), "year") : plural(s.lifespanDays, "day");
  const top = s.mourners.slice(0, 3);
  return {
    epitaph: `It shipped what it could.`,
    opening:
      `We are gathered here to remember ${s.name}, who lived for ${years} and was shaped by ${plural(s.totalCommits, "commit")}.\n\n` +
      `Its first words were "${s.firstWords}". Its last were "${s.lastWords}". ` +
      `In between, ${s.linesWritten.toLocaleString()} lines were written and ${s.linesDeleted.toLocaleString()} were taken away.`,
    survivedBy:
      s.mourners.length === 1
        ? `${s.name} is survived by its only author, ${top[0].name}, who saw it through ${top[0].commits === 1 ? "its single commit" : `all ${top[0].commits} commits`}.`
        : `${s.name} is survived by ${s.mourners.length} contributors, among them ` +
          top.map((m) => `${m.name} (${m.commits} commits)`).join(", ") + ".",
    closing: `Rest well, ${s.name}. Your history is safe in the reflog of our hearts.`,
  };
}

/** "1 day", "2 days", "1.5 years". */
export function plural(n: number, unit: string): string {
  return `${n.toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;
}

function factSheet(s: Stats, t: Tribute): string {
  const lines = [
    `Name: ${s.name}`,
    `Born: ${s.born.toDateString()} — Died: ${s.died.toDateString()} (${s.lifespanDays} days)`,
    `Commits: ${s.totalCommits}; lines written: ${s.linesWritten}; lines deleted: ${s.linesDeleted}`,
    `First commit message: "${s.firstWords}"`,
    `Last commit message: "${s.lastWords}"`,
    t.cause
      ? `Cause of death (stated by the family, treat as fact): ${t.cause}`
      : `Cause of death (heuristic guess from commit patterns): ${s.causeOfDeath}`,
    `Founders: ${s.founders.join(", ") || "unknown"}`,
    `Stayed until the end: ${s.lastToLeave.join(", ") || "no one"}`,
    `Contributors (by commits):`,
    ...s.mourners.slice(0, 15).map(
      (m) => `  - ${m.name}: ${m.commits} commits, +${m.added}/-${m.deleted}, active ${m.first.toDateString()} to ${m.last.toDateString()}`,
    ),
    `Notable commits:`,
    ...s.oddities.map((o) => `  - ${o.label}: "${o.commit.subject}" by ${o.commit.author} (${o.detail})`),
  ];
  if (s.elder) lines.push(`Oldest untouched file: ${s.elder.path}, unchanged since ${s.elder.since.toDateString()}`);
  if (t.eulogy) lines.push(`The family's own eulogy (already written; keep anything you write consistent with it):`, t.eulogy);
  if (t.epitaph) lines.push(`Epitaph chosen by the family: ${t.epitaph}`);
  if (t.memories.length) {
    lines.push(`Memories shared by the mourners (true, use them):`, ...t.memories.map((m) => `  - ${m}`));
  }
  return lines.join("\n");
}
