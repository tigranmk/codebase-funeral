import type { Eulogy } from "./eulogy.js";
import type { Stats } from "./stats.js";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const paras = (s: string) =>
  s.split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${esc(p.trim())}</p>`).join("\n");

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export interface Rites {
  cause: string;
  /** True when the cause came from the user rather than a guess. */
  stated: boolean;
  memories: string[];
}

export function renderHtml(s: Stats, e: Eulogy, r: Rites): string {
  const remembered = r.memories.length
    ? `<h2>Words from the Mourners</h2>${r.memories.map((m) => `<div class="card"><blockquote>“${esc(m)}”</blockquote></div>`).join("")}`
    : e.remembrance
      ? `<h2>Remembered For</h2>${paras(e.remembrance)}`
      : "";

  const mourners = s.mourners.slice(0, 12).map((m) => `
      <li><span class="who">${esc(m.name)}</span>
        <span class="what">${m.commits} commit${m.commits === 1 ? "" : "s"} · +${m.added.toLocaleString()} / −${m.deleted.toLocaleString()}</span></li>`).join("");
  const more = s.mourners.length > 12 ? `<li class="more">and ${s.mourners.length - 12} more</li>` : "";

  const oddities = s.oddities.map((o) => `
      <div class="card">
        <h3>${esc(o.label)}</h3>
        <blockquote>“${esc(o.commit.subject)}”</blockquote>
        <p class="meta">${esc(o.commit.author)} · ${fmtDate(o.commit.date)} · ${esc(o.detail)}</p>
      </div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>In Memoriam: ${esc(s.name)}</title>
<style>
  :root { --bg:#f6f3ee; --ink:#2a2724; --muted:#7a736b; --rule:#d9d2c7; --accent:#6b5b4b; --card:#fffdf9; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#161514; --ink:#e8e3dc; --muted:#9a9289; --rule:#3a3632; --accent:#c4b29c; --card:#1e1c1a; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:18px/1.65 Georgia, "Iowan Old Style", serif; }
  main { max-width:680px; margin:0 auto; padding:64px 16px 96px; }
  header { text-align:center; border-bottom:1px solid var(--rule); padding-bottom:40px; margin-bottom:40px; }
  .eyebrow { letter-spacing:.3em; text-transform:uppercase; font-size:12px; color:var(--muted); }
  h1 { font-size:clamp(36px, 8vw, 56px); font-weight:normal; margin:12px 0 4px; overflow-wrap:anywhere; }
  .dates { color:var(--muted); font-style:italic; }
  .epitaph { margin-top:20px; font-size:20px; color:var(--accent); }
  h2 { font-size:13px; letter-spacing:.25em; text-transform:uppercase; color:var(--muted); font-weight:normal; margin:56px 0 16px; text-align:center; }
  h3 { font-size:16px; margin:0 0 8px; }
  .facts { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:1px; background:var(--rule); border:1px solid var(--rule); }
  .facts div { background:var(--bg); padding:16px; text-align:center; }
  .facts b { display:block; font-size:24px; font-weight:normal; }
  .facts span { font-size:13px; color:var(--muted); }
  svg { width:100%; height:64px; display:block; margin-top:24px; }
  svg rect { fill:var(--accent); opacity:.7; }
  .words { display:grid; gap:16px; grid-template-columns:1fr 1fr; }
  @media (max-width:520px) { .words { grid-template-columns:1fr; } }
  blockquote { margin:0; font-style:italic; overflow-wrap:anywhere; }
  .card { background:var(--card); border:1px solid var(--rule); padding:20px; margin-bottom:12px; }
  .meta { font-size:14px; color:var(--muted); margin:8px 0 0; }
  ul.mourners { list-style:none; padding:0; margin:0; }
  ul.mourners li { display:flex; justify-content:space-between; gap:16px; border-bottom:1px dotted var(--rule); padding:8px 0; flex-wrap:wrap; }
  .what, .more { color:var(--muted); font-size:15px; }
  footer { text-align:center; color:var(--muted); font-size:13px; margin-top:72px; }
</style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">In loving memory of</div>
    <h1>${esc(s.name)}</h1>
    <div class="dates">${fmtDate(s.born)} — ${fmtDate(s.died)}</div>
    <div class="epitaph">${esc(e.epitaph)}</div>
  </header>

  ${paras(e.opening)}

  <div class="facts">
    <div><b>${s.lifespanDays.toLocaleString()}</b><span>day${s.lifespanDays === 1 ? "" : "s"} lived</span></div>
    <div><b>${s.totalCommits.toLocaleString()}</b><span>commit${s.totalCommits === 1 ? "" : "s"}</span></div>
    <div><b>${s.linesWritten.toLocaleString()}</b><span>lines written</span></div>
    <div><b>${s.mourners.length}</b><span>contributor${s.mourners.length === 1 ? "" : "s"}</span></div>
  </div>
  ${timeline(s)}

  <h2>First &amp; Last Words</h2>
  <div class="words">
    <div class="card"><h3>First</h3><blockquote>“${esc(s.firstWords)}”</blockquote></div>
    <div class="card"><h3>Last</h3><blockquote>“${esc(s.lastWords)}”</blockquote></div>
  </div>

  ${oddities ? `<h2>Moments We Remember</h2>${oddities}` : ""}

  ${s.elder ? `<h2>The Elder</h2>
  <div class="card"><blockquote>${esc(s.elder.path)}</blockquote>
    <p class="meta">untouched since ${fmtDate(s.elder.since)}. It never needed to change.</p></div>` : ""}

  <h2>Survived By</h2>
  ${paras(e.survivedBy)}
  <ul class="mourners">${mourners}${more}</ul>

  ${remembered}

  <h2>${r.stated ? "Cause of Death" : "Presumed Cause of Death"}</h2>
  <p style="text-align:center"><i>${esc(r.cause)}</i></p>

  ${e.closing.trim() ? `<h2>Farewell</h2>\n  ${paras(e.closing)}` : ""}

  <footer>Generated by codebase-funeral</footer>
</main>
</body>
</html>
`;
}

function timeline(s: Stats): string {
  const max = Math.max(...s.monthly.map((m) => m.count), 1);
  const w = 100 / s.monthly.length;
  const bars = s.monthly.map((m, i) => {
    const h = (m.count / max) * 60;
    return `<rect x="${(i * w).toFixed(3)}" y="${(64 - h).toFixed(2)}" width="${Math.max(w * 0.8, 0.2).toFixed(3)}" height="${h.toFixed(2)}"><title>${m.month}: ${m.count}</title></rect>`;
  }).join("");
  return `<svg viewBox="0 0 100 64" preserveAspectRatio="none" role="img" aria-label="Commits per month over the project's life">${bars}</svg>`;
}
