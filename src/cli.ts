#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import { assertRepo, readCommits, repoName, trackedFiles } from "./git.js";
import { computeStats } from "./stats.js";
import { DEFAULT_MODEL, missingParts, plural, templateEulogy, userParts, writeEulogy, type Eulogy, type Tribute } from "./eulogy.js";
import { renderHtml } from "./template.js";

// package.json sits one level up from both src/cli.ts and dist/cli.js.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const spinner = ora();

/** `-e` value: literal text, `@path` to read a file, or `@@text` for text that starts with "@". */
function readEulogy(arg: string | undefined): string | undefined {
  if (arg === undefined || !arg.startsWith("@")) return arg;
  if (arg.startsWith("@@")) return arg.slice(1);
  const file = arg.slice(1);
  let text: string;
  try {
    text = readFileSync(resolve(file), "utf8");
  } catch {
    throw new Error(`Can't read the eulogy file ${file}`);
  }
  if (!text.trim()) console.warn(pc.yellow(`The eulogy file ${file} is empty; writing the eulogy for you instead.`));
  return text;
}

const program = new Command()
  .name("codebase-funeral")
  .description("Give your dead repo the funeral it deserves.")
  .version(version)
  .argument("[repo]", "path to the git repository", ".")
  .option("-o, --out <file>", "output HTML file (default: <repo-name>.funeral.html)")
  .option("--no-ai", "skip Claude and use the built-in eulogy")
  .option("-m, --model <id>", "Claude model to use", DEFAULT_MODEL)
  .option("-c, --cause <text>", "the real cause of death (optional; otherwise Claude or a git heuristic guesses)")
  .option("--memory <text>", "a memory to share; repeat for more (optional)", (m: string, all: string[] = []) => [...all, m])
  .option("-e, --eulogy <text|@file>", "your own eulogy, used as written; @path reads it from a file, @@ escapes a leading @ (optional)")
  .option("--epitaph <text>", "the line for the headstone (optional)")
  .action(async (repoArg: string, opts: {
    out?: string; ai: boolean; model: string; cause?: string; memory?: string[]; eulogy?: string; epitaph?: string;
  }) => {
    const tribute: Tribute = {
      cause: opts.cause?.trim() || undefined,
      memories: (opts.memory ?? []).map((m) => m.trim()).filter(Boolean),
      eulogy: readEulogy(opts.eulogy)?.trim() || undefined,
      epitaph: opts.epitaph?.trim() || undefined,
    };
    const repo = resolve(repoArg);
    assertRepo(repo);

    spinner.start("Reading the family history…");
    const name = repoName(repo);
    const stats = computeStats(name, await readCommits(repo), trackedFiles(repo));
    spinner.succeed(`${plural(stats.totalCommits, "commit")} by ${plural(stats.mourners.length, "contributor")} over ${plural(stats.lifespanDays, "day")}`);

    // Built-in text is the base; Claude fills what's missing; the user's own words win.
    let generated: Partial<Eulogy> = {};
    if (!missingParts(tribute).length) {
      spinner.info("Using your words throughout; Claude isn't needed");
    } else if (opts.ai && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      spinner.info("No ANTHROPIC_API_KEY set. Using the built-in eulogy.");
    } else if (opts.ai) {
      spinner.start("Writing the eulogy…");
      try {
        generated = await writeEulogy(stats, tribute, opts.model);
        spinner.succeed("Eulogy written");
      } catch (err) {
        const why = err instanceof Anthropic.AuthenticationError ? "the API key was rejected" : (err as Error).message;
        spinner.warn(`Couldn't reach Claude (${why}). Using the built-in eulogy.`);
      }
    }
    const eulogy: Eulogy = { ...templateEulogy(stats), ...generated, ...userParts(tribute) };

    const out = resolve(opts.out ?? `${name}.funeral.html`);
    // The user's word beats Claude's inference, which beats the git heuristic.
    const cause = tribute.cause ?? eulogy.cause ?? stats.causeOfDeath;
    writeFileSync(out, renderHtml(stats, eulogy, { cause, stated: Boolean(tribute.cause), memories: tribute.memories }));
    console.log(`\n  ${pc.dim("Here lies")} ${pc.bold(name)}. ${pc.dim(cause.replace(/[.!?]?$/, (p) => p || "."))}`);
    console.log(`  ${pc.dim("Program printed to")} ${out}\n`);
  });

// Every failure ends here: one red line and exit code 1, never a stack trace.
program.parseAsync().catch((err: Error) => {
  if (spinner.isSpinning) spinner.fail(err.message);
  else console.error(pc.red(err.message));
  process.exit(1);
});
