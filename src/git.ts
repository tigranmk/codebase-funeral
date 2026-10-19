import { execFileSync, spawn } from "node:child_process";
import { basename } from "node:path";
import { createInterface } from "node:readline";

export interface FileChange {
  path: string;
  /** Set when this change moved the file here from another path. */
  renamed?: boolean;
  added: number;
  deleted: number;
}

export interface Commit {
  hash: string;
  author: string;
  email: string;
  date: Date;
  /** "HH:MM" on the author's own clock, from the commit's timezone offset. */
  localTime: string;
  subject: string;
  files: FileChange[];
}

// Separators that won't show up in commit subjects.
const REC = "\x1e";
const FIELD = "\x1f";

// Print non-ASCII paths as-is instead of C-quoting them ("caf\303\251.txt").
const GIT_CONFIG = ["-c", "core.quotePath=false"];

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT_CONFIG, "-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasHead(repo: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

export function assertRepo(repo: string): void {
  try {
    git(repo, ["rev-parse", "--git-dir"]);
  } catch {
    throw new Error(`${repo} is not a git repository`);
  }
}

export function repoName(repo: string): string {
  const bare = git(repo, ["rev-parse", "--is-bare-repository"]).trim() === "true";
  // A bare repo has no working tree, so name it after its directory, minus the conventional ".git".
  const dir = git(repo, ["rev-parse", bare ? "--absolute-git-dir" : "--show-toplevel"]).trim();
  return basename(dir).replace(/\.git$/, "") || basename(dir);
}

/** All commits on HEAD, oldest first, with per-file line counts. Streams git's output, so history size is unbounded. */
export async function readCommits(repo: string): Promise<Commit[]> {
  // An unborn branch has no HEAD, and git log fails on it.
  if (!hasHead(repo)) return [];

  const child = spawn("git", [
    ...GIT_CONFIG,
    "-C",
    repo,
    "log",
    "--reverse",
    "--no-merges",
    "--numstat",
    `--format=${REC}%H${FIELD}%aN${FIELD}%aE${FIELD}%aI${FIELD}%s`,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const exited = new Promise<number | null>((res, rej) => {
    child.on("error", rej);
    child.on("close", res);
  });

  const commits: Commit[] = [];
  let current: Commit | undefined;
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (line.startsWith(REC)) {
      const [hash, author, email, iso, subject = ""] = line.slice(1).split(FIELD);
      // %aI is strict ISO 8601 with the author's offset, so chars 11-16 are their wall-clock time.
      current = { hash, author, email, date: new Date(iso), localTime: iso.slice(11, 16), subject, files: [] };
      commits.push(current);
      continue;
    }
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m || !current) continue;
    const path = renamedTo(m[3]);
    current.files.push({
      path,
      ...(path !== m[3] && { renamed: true }),
      added: m[1] === "-" ? 0 : Number(m[1]),
      deleted: m[2] === "-" ? 0 : Number(m[2]),
    });
  }

  const code = await exited;
  if (code !== 0) throw new Error(`git log failed: ${stderr.trim() || `exit code ${code}`}`);
  return commits;
}

/**
 * numstat writes a rename as "old => new" or "dir/{old => new}/file". Return the new path.
 * (Rename detection stays on so a moved file isn't counted as every line deleted and re-added.)
 */
export function renamedTo(p: string): string {
  const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  // "{ => sub}/x" and "{sub => }/x" leave a doubled or leading slash behind.
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/{2,}/g, "/").replace(/^\//, "");
  const i = p.indexOf(" => ");
  return i === -1 ? p : p.slice(i + 4);
}

/** Files still present at HEAD, as paths from the repository root. Works in bare repos and subdirectories. */
export function trackedFiles(repo: string): Set<string> {
  if (!hasHead(repo)) return new Set();
  return new Set(git(repo, ["ls-tree", "-r", "--name-only", "--full-tree", "HEAD"]).split("\n").filter(Boolean));
}
