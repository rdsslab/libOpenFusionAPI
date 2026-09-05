import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");
const OUT_DIR = path.join(ROOT, "www");
const OUT_FILE = path.join(OUT_DIR, "index.html");
const FAVICON_FILE = path.join(OUT_DIR, "favicon.png");

const SITE_BASE = "http://localhost:3000";
const GITHUB_REPO = "https://github.com/rdsslab/libOpenFusionAPI";
const GITHUB_ISSUES = "https://github.com/rdsslab/libOpenFusionAPI/issues";

function readPackageJson() {
  const raw = fs.readFileSync(PKG_PATH, "utf8");
  const pkg = JSON.parse(raw);
  return {
    name: pkg.name || "libOpenFusionAPI",
    version: pkg.version || "0.0.0",
    description:
      pkg.description ||
      "Library based on Fastify to create APIs quickly and easily from a web interface.",
    repository: pkg.repository?.url || `${GITHUB_REPO}.git`,
    homepage: pkg.homepage || GITHUB_REPO,
    bugs: pkg.bugs?.url || GITHUB_ISSUES,
    license: pkg.license || "MIT",
    author: pkg.author || "edwinspire",
  };
}

function normalizeRemote(url) {
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pkg = readPackageJson();
const repoUrl = normalizeRemote(pkg.repository);
const issuesUrl = GITHUB_ISSUES;
const versionMajor = parseInt(String(pkg.version).split(".")[0], 10) || 0;

const ICONS = {
  bolt:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  layers:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
  lock:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  sparkles:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>',
  gauge:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l4-4"/><path d="M12 21a3 3 0 0 1-3-3c0-1.5 1-2 3-3s3-1.5 3-3"/></svg>',
  clock:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>',
  arrowUpRight:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  book:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  github:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.6.23 2.77.11 3.06a4.5 4.5 0 0 1 1.19 3.1c0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.18c0 .31.2.66.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/></svg>',
  check:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  users:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  code:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
};

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${esc(pkg.description)}" />
  <meta name="author" content="${esc(pkg.author)}" />
  <meta name="theme-color" content="#070c18" />
  <link rel="icon" href="/favicon.png" type="image/png" />
  <title>${esc(pkg.name)} | Runtime API Platform</title>
  <style>
    :root {
      --bg: #070c18;
      --bg-2: #0b1326;
      --ink: #eaf0ff;
      --muted: #97a5c8;
      --dim: #6b7896;
      --line: rgba(148, 166, 210, 0.16);
      --line-strong: rgba(148, 166, 210, 0.28);
      --panel: rgba(255, 255, 255, 0.035);
      --panel-2: rgba(255, 255, 255, 0.06);
      --brand: #4d7cff;
      --brand-2: #1e5eff;
      --teal: #00c2a8;
      --teal-2: #00a58f;
      --grad: linear-gradient(120deg, #4d7cff 0%, #00c2a8 100%);
      --shadow-lg: 0 30px 80px rgba(0, 0, 0, 0.55);
      --radius: 18px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    }

    * { box-sizing: border-box; }

    html { scroll-behavior: smooth; }

    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--font);
      background:
        radial-gradient(1100px 520px at 12% -8%, #12307a66 0%, transparent 55%),
        radial-gradient(900px 520px at 96% -4%, #00a58f26 0%, transparent 55%),
        linear-gradient(180deg, #0a1122 0%, var(--bg) 40%, var(--bg) 100%);
      background-attachment: fixed;
      -webkit-font-smoothing: antialiased;
      line-height: 1.55;
      overflow-x: hidden;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(148, 166, 210, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 166, 210, 0.05) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 75%);
      -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 75%);
      pointer-events: none;
      z-index: 0;
    }

    a { color: inherit; }

    .wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; position: relative; z-index: 1; }

    /* ---------- Navbar ---------- */
    .navbar {
      position: sticky;
      top: 0;
      z-index: 50;
      border-bottom: 1px solid var(--line);
      background: rgba(7, 12, 24, 0.78);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    .nav-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding-top: 14px;
      padding-bottom: 14px;
    }

    .brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; }

    .brand-mark {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 15px;
      letter-spacing: 0.02em;
      color: #fff;
      background: var(--grad);
      box-shadow: 0 8px 24px rgba(30, 94, 255, 0.4);
    }

    .brand-text { display: flex; flex-direction: column; line-height: 1.2; }
    .brand-text strong { font-size: 15px; letter-spacing: 0.01em; }
    .brand-text small { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }

    .nav-links { display: flex; gap: 26px; }
    .nav-links a { color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 500; transition: color 160ms ease; }
    .nav-links a:hover { color: var(--ink); }

    .nav-cta { display: flex; align-items: center; gap: 10px; }

    /* ---------- Buttons ---------- */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      padding: 10px 16px;
      border-radius: 11px;
      border: 1px solid transparent;
      font-weight: 600;
      font-size: 14px;
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease;
      cursor: pointer;
      white-space: nowrap;
    }

    .btn:hover { transform: translateY(-2px); }

    .btn-primary {
      color: #fff;
      background: var(--grad);
      box-shadow: 0 10px 28px rgba(30, 94, 255, 0.32);
    }
    .btn-primary:hover { box-shadow: 0 16px 40px rgba(0, 194, 168, 0.4); }

    .btn-ghost {
      color: var(--ink);
      border-color: var(--line-strong);
      background: var(--panel);
    }
    .btn-ghost:hover { border-color: var(--brand); background: var(--panel-2); }

    .btn-lg { padding: 14px 22px; font-size: 15px; }

    /* ---------- Hero ---------- */
    .hero { padding-top: 76px; }

    .hero-grid {
      display: grid;
      grid-template-columns: 1.05fr 1fr;
      gap: 56px;
      align-items: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 7px 13px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--muted);
      font-size: 12.5px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--teal);
      box-shadow: 0 0 0 0 rgba(0, 194, 168, 0.6);
      animation: pulse 2.4s ease-out infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(0, 194, 168, 0.55); }
      70% { box-shadow: 0 0 0 9px rgba(0, 194, 168, 0); }
      100% { box-shadow: 0 0 0 0 rgba(0, 194, 168, 0); }
    }

    h1 {
      margin: 22px 0 0;
      font-size: clamp(2.4rem, 5vw, 4.05rem);
      line-height: 1.04;
      letter-spacing: -0.025em;
      font-weight: 800;
    }

    .grad-text {
      background: var(--grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .lead {
      margin: 20px 0 0;
      color: var(--muted);
      font-size: 17px;
      max-width: 56ch;
    }

    .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }

    .hero-points { display: flex; flex-wrap: wrap; gap: 18px; list-style: none; margin: 26px 0 0; padding: 0; }
    .hero-points li { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13.5px; }
    .hero-points svg { color: var(--teal); }

    /* Terminal */
    .hero-visual { position: relative; }

    .terminal {
      position: relative;
      z-index: 2;
      border: 1px solid var(--line-strong);
      border-radius: 16px;
      background: rgba(9, 15, 30, 0.9);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    .term-bar {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
    }

    .term-bar span { width: 11px; height: 11px; border-radius: 50%; }
    .term-bar span:nth-child(1) { background: #ff5f57; }
    .term-bar span:nth-child(2) { background: #febc2e; }
    .term-bar span:nth-child(3) { background: #28c840; }
    .term-bar i { margin-left: auto; color: var(--dim); font-size: 11.5px; font-family: var(--mono); font-style: normal; }

    .term-body { padding: 18px 20px; font-family: var(--mono); font-size: 12.8px; line-height: 1.9; }
    .ln { margin: 0; opacity: 0; animation: lnIn 480ms ease forwards; }
    .ln:nth-child(1) { animation-delay: 0.15s; }
    .ln:nth-child(2) { animation-delay: 0.4s; }
    .ln:nth-child(3) { animation-delay: 0.7s; }
    .ln:nth-child(4) { animation-delay: 0.9s; }
    .ln:nth-child(5) { animation-delay: 1.05s; }
    .ln:nth-child(6) { animation-delay: 1.2s; }
    .ln:nth-child(7) { animation-delay: 1.35s; }
    .ln:nth-child(8) { animation-delay: 1.55s; }
    .ln:nth-child(9) { animation-delay: 1.7s; }

    @keyframes lnIn {
      from { opacity: 0; transform: translateX(-6px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .cmt { color: #5b6a8c; }
    .meth { color: var(--teal); font-weight: 600; }
    .url { color: var(--brand); }
    .resp { color: #4e5d82; }
    .code { color: #7ee8d2; }
    .jl { padding-left: 18px; }
    .key { color: #eaf0ff; }
    .punc { color: #647396; }
    .val { color: #7ee8d2; }

    .glow {
      position: absolute;
      border-radius: 50%;
      filter: blur(70px);
      z-index: 1;
      pointer-events: none;
    }
    .glow-blue { width: 220px; height: 220px; background: #1e5eff55; top: -60px; left: -80px; }
    .glow-teal { width: 220px; height: 220px; background: #00a58f40; bottom: -70px; right: -60px; }

    /* Stats bar */
    .stats {
      margin-top: 74px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      overflow: hidden;
    }

    .stat { padding: 24px; text-align: center; border-left: 1px solid var(--line); }
    .stat:first-child { border-left: 0; }

    .stat .num,
    .stat .lbl-special {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: var(--grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      display: inline-block;
    }

    .stat .suffix { color: var(--teal); font-size: 20px; font-weight: 700; }
    .stat .lbl { display: block; margin-top: 6px; color: var(--dim); font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.06em; }

    /* ---------- Sections ---------- */
    section { scroll-margin-top: 90px; }

    .section { padding-top: 110px; }

    .sec-head { text-align: center; max-width: 640px; margin: 0 auto 46px; }
    .sec-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--teal);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 700;
    }
    .sec-eyebrow::before,
    .sec-eyebrow::after { content: ""; width: 22px; height: 1px; background: linear-gradient(90deg, transparent, var(--teal)); }
    .sec-eyebrow::after { background: linear-gradient(90deg, var(--teal), transparent); }

    .sec-head h2 { margin: 12px 0 0; font-size: clamp(1.7rem, 3.4vw, 2.4rem); letter-spacing: -0.02em; }
    .sec-head p { color: var(--muted); margin: 12px 0 0; }

    /* Feature cards */
    .grid-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }

    .card {
      position: relative;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      padding: 24px;
      overflow: hidden;
      transition: transform 200ms ease, border-color 200ms ease, background 200ms ease;
    }

    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(420px 180px at 50% -30%, #1e5eff22 0%, transparent 60%);
      opacity: 0;
      transition: opacity 200ms ease;
    }

    .card:hover { transform: translateY(-5px); border-color: var(--line-strong); background: var(--panel-2); }
    .card:hover::before { opacity: 1; }

    .icon-tile {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      display: grid;
      place-items: center;
      color: #fff;
      background: var(--grad);
      box-shadow: 0 10px 24px rgba(30, 94, 255, 0.35);
      margin-bottom: 18px;
      position: relative;
      z-index: 1;
    }

    .card h3 { margin: 0 0 8px; font-size: 17.5px; letter-spacing: -0.01em; position: relative; z-index: 1; }
    .card p { margin: 0; color: var(--muted); font-size: 14.5px; line-height: 1.6; position: relative; z-index: 1; }

    /* Handlers panel */
    .handlers-panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      padding: 34px;
    }

    .handler-chips { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 11px 18px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      font-family: var(--mono);
      font-size: 13.5px;
      color: var(--ink);
      transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
    }

    .chip:hover { border-color: var(--brand); transform: translateY(-2px); box-shadow: 0 10px 26px rgba(30, 94, 255, 0.22); }

    .chip .cdt {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--grad);
    }

    /* Problems */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }

    .vs-card h3 { display: flex; align-items: center; gap: 10px; font-size: 17px; margin: 0 0 18px; }
    .vs-card h3 svg { color: var(--brand); }

    .vs-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 13px; }
    .vs-list li { display: flex; gap: 12px; align-items: flex-start; color: var(--muted); font-size: 14.5px; }
    .vs-list .xi { flex-shrink: 0; margin-top: 2px; }
    .vs-list .xi.ok { color: var(--teal); }
    .vs-list .xi.no { color: #ff6b6b; }

    /* Audience */
    .grid-audience { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }

    .aud-card { display: flex; gap: 14px; align-items: center; padding: 16px 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
    .aud-card .av { width: 38px; height: 38px; flex-shrink: 0; border-radius: 11px; display: grid; place-items: center; color: var(--teal); background: var(--panel-2); border: 1px solid var(--line); }
    .aud-card div strong { display: block; font-size: 15px; }
    .aud-card div span { color: var(--dim); font-size: 12.5px; }

    /* Quick start */
    .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; position: relative; }

    .steps::before {
      content: "";
      position: absolute;
      top: 25px;
      left: 8%;
      right: 8%;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--line-strong), transparent);
    }

    .step { position: relative; text-align: center; padding: 0 6px; }
    .step .n {
      width: 52px;
      height: 52px;
      margin: 0 auto 16px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
      background: var(--panel-2);
      border: 1px solid var(--line-strong);
      position: relative;
      z-index: 1;
    }
    .step:nth-child(1) .n { background: linear-gradient(135deg, #1e5eff, #4d7cff); }
    .step:nth-child(2) .n { background: linear-gradient(135deg, #1e5eff, #00a58f); }
    .step:nth-child(3) .n { background: linear-gradient(135deg, #00a58f, #00c2a8); }
    .step:nth-child(4) .n { background: linear-gradient(135deg, #00c2a8, #00a58f); }

    .step h3 { margin: 0 0 6px; font-size: 15.5px; }
    .step p { margin: 0; color: var(--muted); font-size: 13.5px; }

    /* Try it */
    .try-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: stretch; }

    .code-block {
      border: 1px solid var(--line-strong);
      border-radius: 16px;
      background: rgba(9, 15, 30, 0.9);
      overflow: hidden;
      box-shadow: var(--shadow-lg);
    }

    .code-block .bar { display: flex; align-items: center; gap: 7px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: rgba(255, 255, 255, 0.03); }
    .code-block .bar i { margin-left: auto; color: var(--dim); font-size: 11.5px; font-family: var(--mono); font-style: normal; }
    .code-block .bar span { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
    .code-block .bar span:nth-child(1) { background: #ff5f57; }
    .code-block .bar span:nth-child(2) { background: #febc2e; }
    .code-block .bar span:nth-child(3) { background: #28c840; }

    .code-block pre { margin: 0; padding: 18px 20px; font-family: var(--mono); font-size: 13px; line-height: 1.9; overflow-x: auto; color: #cdd9f5; }
    .code-block .c-cmt { color: #5b6a8c; }
    .code-block .c-meth { color: var(--teal); font-weight: 600; }
    .code-block .c-url { color: var(--brand); }
    .code-block .c-str { color: #7ee8d2; }

    /* CTA band */
    .cta-band {
      margin-top: 110px;
      border: 1px solid var(--line-strong);
      border-radius: 22px;
      padding: 48px 42px;
      text-align: center;
      background:
        radial-gradient(600px 260px at 50% -60%, #1e5eff33 0%, transparent 60%),
        var(--panel);
      position: relative;
      overflow: hidden;
    }

    .cta-band h2 { margin: 0 0 10px; font-size: clamp(1.5rem, 3vw, 2.1rem); letter-spacing: -0.02em; }
    .cta-band p { color: var(--muted); max-width: 560px; margin: 0 auto 26px; }
    .cta-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; }

    /* Footer */
    footer { margin-top: 90px; border-top: 1px solid var(--line); }

    .foot-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      padding-top: 30px;
      padding-bottom: 42px;
    }

    .foot-brand { display: inline-flex; align-items: center; gap: 12px; }
    .foot-brand .brand-mark { width: 34px; height: 34px; font-size: 13px; box-shadow: none; }
    .foot-brand span strong { display: block; font-size: 14px; }
    .foot-brand span small { color: var(--dim); font-size: 12px; }

    .foot-right { display: flex; align-items: center; gap: 22px; }
    .foot-links { display: flex; gap: 18px; }
    .foot-links a { color: var(--muted); text-decoration: none; font-size: 13.5px; transition: color 160ms ease; }
    .foot-links a:hover { color: var(--teal); }
    .foot-ver { color: var(--dim); font-family: var(--mono); font-size: 12.5px; }

    /* Reveal */
    .reveal { opacity: 0; transform: translateY(26px); transition: opacity 560ms ease, transform 560ms ease; }

    .reveal.in { opacity: 1; transform: translateY(0); }

    @media (width <= 980px) {
      .hero-grid { grid-template-columns: 1fr; gap: 44px; }
      .nav-links { display: none; }
      .grid-features, .grid-audience { grid-template-columns: repeat(2, 1fr); }
      .grid-2, .try-grid { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .stat:nth-child(3) { border-left: 0; }
      .stat:nth-child(n + 3) { border-top: 1px solid var(--line); }
    }

    @media (width <= 640px) {
      .grid-features, .grid-audience { grid-template-columns: 1fr; }
      .stats { grid-template-columns: 1fr 1fr; }
      .steps { grid-template-columns: 1fr 1fr; }
      .steps::before { display: none; }
      .cta-band { padding: 38px 24px; }
      .nav-cta .btn-ghost { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      .reveal { opacity: 1; transform: none; transition: none; }
      .ln { animation: none; opacity: 1; }
    }
  </style>
</head>
<body>
  <header class="navbar">
    <div class="wrap nav-inner">
      <a class="brand" href="#top">
        <span class="brand-mark">OF</span>
        <span class="brand-text"><strong>${esc(pkg.name)}</strong><small>Runtime API Platform</small></span>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="#features">Features</a>
        <a href="#handlers">Handlers</a>
        <a href="#problems">Why it wins</a>
        <a href="#quickstart">Quick Start</a>
        <a href="#try">Try it</a>
      </nav>
      <div class="nav-cta">
        <a class="btn btn-ghost" href="${esc(repoUrl)}" target="_blank" rel="noopener">${ICONS.github} GitHub</a>
        <a class="btn btn-primary" href="${esc(repoUrl)}#readme" target="_blank" rel="noopener">Get Started ${ICONS.arrowUpRight}</a>
      </div>
    </div>
  </header>

  <main id="top">
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <span class="badge"><span class="pulse"></span> Fastify-powered API runtime · v${esc(pkg.version)}</span>
          <h1>Ship <span class="grad-text">configurable APIs</span> with production-ready control.</h1>
          <p class="lead">
            ${esc(pkg.description)} Built on Node.js and Fastify, it turns configuration into live
            HTTP and WebSocket endpoints across SQL, scripts, SOAP, MCP and MongoDB — for humans
            and AI agents alike.
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="${esc(repoUrl)}#readme" target="_blank" rel="noopener">${ICONS.book} Read the docs</a>
            <a class="btn btn-ghost btn-lg" href="${SITE_BASE}/api/system/server/version/prd" target="_blank" rel="noopener">Live server version ${ICONS.arrowUpRight}</a>
          </div>
          <ul class="hero-points">
            <li>${ICONS.check} No boilerplate</li>
            <li>${ICONS.check} Dev / QA / Prod</li>
            <li>${ICONS.check} MCP &amp; AI ready</li>
          </ul>
        </div>

        <div class="hero-visual">
          <div class="glow glow-blue"></div>
          <div class="glow glow-teal"></div>
          <div class="terminal">
            <div class="term-bar"><span></span><span></span><span></span><i>libOpenFusionAPI</i></div>
            <div class="term-body">
              <p class="ln"><span class="cmt"># public endpoints you can hit right now</span></p>
              <p class="ln"><span class="meth">GET</span> <span class="url">/api/system/server/version/prd</span></p>
              <p class="ln resp"><span style="color:#4e5d82">←</span> <span class="code">200 OK</span></p>
              <p class="ln"><span class="cmt">{"libOpenFusionAPI":</span> <span class="val">"${esc(pkg.version)}"</span><span class="punc">,</span></p>
              <p class="ln jl"><span class="key">"handlers"</span><span class="punc">:</span> <span class="val">"10+ pluggable"</span><span class="punc">,</span></p>
              <p class="ln jl"><span class="key">"environments"</span><span class="punc">:</span> <span class="val">"dev, qa, prd"</span><span class="punc">}</span></p>
              <p class="ln"><span class="meth">GET</span> <span class="url">/api/system/api/agent_onboarding/prd</span></p>
              <p class="ln resp"><span style="color:#4e5d82">←</span> <span class="code">agent guide served in milliseconds</span></p>
            </div>
          </div>
        </div>
      </div>

      <div class="wrap" style="padding-top:34px">
        <div class="stats">
          <div class="stat"><span class="num" data-count="${versionMajor}">0</span><span class="lbl">Current version</span></div>
          <div class="stat"><span class="num" data-count="3">0</span><span class="suffix">+</span><span class="lbl">Environment tiers</span></div>
          <div class="stat"><span class="num" data-count="10">0</span><span class="suffix">+</span><span class="lbl">Endpoint handlers</span></div>
          <div class="stat"><span class="lbl-special">MIT</span><span class="lbl">Open-source license</span></div>
        </div>
      </div>
    </section>

    <section class="section" id="features">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="sec-eyebrow">Features</span>
          <h2>Everything a modern API layer needs</h2>
          <p>Describe the service, pick a handler, deploy. The runtime handles the plumbing.</p>
        </div>
        <div class="grid-features">
          <article class="card reveal">
            <span class="icon-tile">${ICONS.bolt}</span>
            <h3>Rapid endpoint creation</h3>
            <p>Configure endpoints instead of hand-writing boilerplate. Friction drops from days to minutes.</p>
          </article>
          <article class="card reveal">
            <span class="icon-tile">${ICONS.layers}</span>
            <h3>Pluggable handlers</h3>
            <p>SQL, MongoDB, SOAP, MCP, JS scripts, FETCH, HANA, bulk inserts, text and native functions.</p>
          </article>
          <article class="card reveal">
            <span class="icon-tile">${ICONS.lock}</span>
            <h3>Access control built-in</h3>
            <p>Public, private and bearer access levels with per-endpoint policy hooks.</p>
          </article>
          <article class="card reveal">
            <span class="icon-tile">${ICONS.sparkles}</span>
            <h3>MCP &amp; AI-agent native</h3>
            <p>Agents create applications, variables and endpoints through MCP tooling and JSON Schema contracts.</p>
          </article>
          <article class="card reveal">
            <span class="icon-tile">${ICONS.gauge}</span>
            <h3>Caching &amp; observability</h3>
            <p>Endpoint caching, tracing, request logging and lifecycle events out of the box.</p>
          </article>
          <article class="card reveal">
            <span class="icon-tile">${ICONS.clock}</span>
            <h3>Scheduling &amp; bots</h3>
            <p>Recurring interval/cron tasks and messaging bots, all managed in-platform.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="handlers">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="sec-eyebrow">Handlers</span>
          <h2>One runtime, many protocols</h2>
          <p>Handlers are pluggable and composable — combine them freely per endpoint.</p>
        </div>
        <div class="handlers-panel reveal">
          <div class="handler-chips">
            <span class="chip"><span class="cdt"></span>SQL</span>
            <span class="chip"><span class="cdt"></span>MongoDB</span>
            <span class="chip"><span class="cdt"></span>SOAP</span>
            <span class="chip"><span class="cdt"></span>MCP</span>
            <span class="chip"><span class="cdt"></span>JS&nbsp;Script</span>
            <span class="chip"><span class="cdt"></span>FETCH</span>
            <span class="chip"><span class="cdt"></span>HANA</span>
            <span class="chip"><span class="cdt"></span>SQL_BULK_I</span>
            <span class="chip"><span class="cdt"></span>TEXT</span>
            <span class="chip"><span class="cdt"></span>FUNCTION</span>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="problems">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="sec-eyebrow">Why OpenFusionAPI</span>
          <h2>Problems it solves</h2>
          <p>Stop losing time to infrastructure and repeatable ceremony.</p>
        </div>
        <div class="grid-2">
          <article class="card vs-card reveal">
            <h3><span class="icon-tile" style="width:34px;height:34px">${ICONS.code}</span> The old way</h3>
            <ul class="vs-list">
              <li><span class="xi no">${ICONS.check}</span>Slow, redundant, boilerplate-heavy development.</li>
              <li><span class="xi no">${ICONS.check}</span>Complex, inconsistent environment management.</li>
              <li><span class="xi no">${ICONS.check}</span>Security and validation overhead on every service.</li>
              <li><span class="xi no">${ICONS.check}</span>AI code with no reliable deployment surface.</li>
            </ul>
          </article>
          <article class="card vs-card reveal">
            <h3><span class="icon-tile" style="width:34px;height:34px">${ICONS.sparkles}</span> With OpenFusionAPI</h3>
            <ul class="vs-list">
              <li><span class="xi ok">${ICONS.check}</span>Configure in minutes, zero boilerplate to maintain.</li>
              <li><span class="xi ok">${ICONS.check}</span>Native dev, qa and production tiers.</li>
              <li><span class="xi ok">${ICONS.check}</span>JSON Schema validation and access control built in.</li>
              <li><span class="xi ok">${ICONS.check}</span>MCP tooling that lets agents assemble deployable services.</li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="audience">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="sec-eyebrow">Built for</span>
          <h2>Who benefits</h2>
          <p>Engineers, platforms and AI agents get the same low-friction path to production.</p>
        </div>
        <div class="grid-audience">
          <div class="aud-card reveal">
            <span class="av">${ICONS.users}</span>
            <div><strong>Backend developers</strong><span>Ship internal and public APIs faster</span></div>
          </div>
          <div class="aud-card reveal">
            <span class="av">${ICONS.layers}</span>
            <div><strong>API architects</strong><span>Consistent contracts, schemas and governance</span></div>
          </div>
          <div class="aud-card reveal">
            <span class="av">${ICONS.bolt}</span>
            <div><strong>Integration engineers</strong><span>SQL, SOAP, REST and NoSQL in one place</span></div>
          </div>
          <div class="aud-card reveal">
            <span class="av">${ICONS.gauge}</span>
            <div><strong>DevOps &amp; platform teams</strong><span>Multi-environment control and observability</span></div>
          </div>
          <div class="aud-card reveal">
            <span class="av">${ICONS.sparkles}</span>
            <div><strong>AI &amp; automation teams</strong><span>MCP-native service creation and upkeep</span></div>
          </div>
          <div class="aud-card reveal">
            <span class="av">${ICONS.lock}</span>
            <div><strong>Enterprises at scale</strong><span>Reusable variables, access rules and caching</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="quickstart">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="sec-eyebrow">Quick start</span>
          <h2>From zero to serving traffic</h2>
          <p>No scaffolding, no framework wiring, no redeploys for a change of config.</p>
        </div>
        <div class="steps">
          <div class="step reveal">
            <div class="n">1</div>
            <h3>Boot the server</h3>
            <p>Configure the <code>.env</code> file and start the Fastify runtime.</p>
          </div>
          <div class="step reveal">
            <div class="n">2</div>
            <h3>Create an application</h3>
            <p>Scoped container for variables, keys and endpoints.</p>
          </div>
          <div class="step reveal">
            <div class="n">3</div>
            <h3>Configure endpoints</h3>
            <p>Pick a handler, method, access level and JSON Schema.</p>
          </div>
          <div class="step reveal">
            <div class="n">4</div>
            <h3>Deploy</h3>
            <p>Publish and watch the endpoint serve real traffic.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="try">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="sec-eyebrow">Try it</span>
          <h2>Real endpoints, ready to curl</h2>
          <p>These public routes exist on any running instance of the platform.</p>
        </div>
        <div class="try-grid">
          <div class="code-block reveal">
            <div class="bar"><span></span><span></span><span></span><i>endpoints</i></div>
            <pre>
<span class="c-cmt"># Public system endpoints</span>
<span class="c-meth">GET</span> <span class="c-url">${SITE_BASE}/api/system/server/version/prd</span>
<span class="c-meth">GET</span> <span class="c-url">${SITE_BASE}/api/system/api/agent_onboarding/prd</span>

<span class="c-cmt"># Public demo app endpoint</span>
<span class="c-meth">GET</span> <span class="c-url">${SITE_BASE}/api/demo/ofapi/javascript/example03/prd</span></pre>
          </div>
          <div class="code-block reveal">
            <div class="bar"><span></span><span></span><span></span><i>response</i></div>
            <pre>
<span class="c-cmt">// GET /api/system/server/version/prd</span>
<span class="c-str">{
  "libOpenFusionAPI": {
    "version": "${esc(pkg.version)}"
  },
  "runtime": "fastify",
  "status": "running"
}</span></pre>
          </div>
        </div>
      </div>
    </section>

    <div class="wrap">
      <section class="cta-band reveal">
        <h2>Ready to build your next API in minutes?</h2>
        <p>Explore the repository, read the guide, or bring your own roadmap to the issues page. OpenFusionAPI is open source under the MIT license.</p>
        <div class="cta-actions">
          <a class="btn btn-primary btn-lg" href="${esc(repoUrl)}#readme" target="_blank" rel="noopener">${ICONS.github} Open the repository</a>
          <a class="btn btn-ghost btn-lg" href="${esc(issuesUrl)}" target="_blank" rel="noopener">Report an issue</a>
        </div>
      </section>
    </div>
  </main>

  <footer>
    <div class="wrap foot-inner">
      <div class="foot-brand">
        <span class="brand-mark">OF</span>
        <span><strong>${esc(pkg.name)}</strong><small>Maintained by ${esc(pkg.author)}</small></span>
      </div>
      <div class="foot-right">
        <div class="foot-links">
          <a href="${esc(repoUrl)}" target="_blank" rel="noopener">Repository</a>
          <a href="${esc(issuesUrl)}" target="_blank" rel="noopener">Issues</a>
          <a href="${esc(repoUrl)}#readme" target="_blank" rel="noopener">Documentation</a>
        </div>
        <span class="foot-ver">v${esc(pkg.version)} · ${esc(pkg.license)}</span>
      </div>
    </div>
  </footer>

  <script>
    (function () {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var en = entries[i];
          if (en.isIntersecting) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
        }
      }, { threshold: 0.14 });

      var revealEls = document.querySelectorAll(".reveal");
      for (var r = 0; r < revealEls.length; r++) {
        io.observe(revealEls[r]);
      }

      function animateNumber(el) {
        var target = Number(el.getAttribute("data-count") || 0);
        if (!target) {
          el.textContent = String(target);
          return;
        }
        var duration = 950;
        var start = performance.now();
        function step(now) {
          var p = Math.min(1, (now - start) / duration);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = String(Math.round(target * eased));
          if (p < 1) {
            requestAnimationFrame(step);
          } else {
            el.textContent = String(target);
          }
        }
        requestAnimationFrame(step);
      }

      var stats = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var en = entries[i];
          if (en.isIntersecting) {
            var num = en.target.querySelector(".num");
            if (num) {
              animateNumber(num);
            }
            stats.unobserve(en.target);
          }
        }
      }, { threshold: 0.4 });

      var statEls = document.querySelectorAll(".stat");
      for (var s = 0; s < statEls.length; s++) {
        stats.observe(statEls[s]);
      }
    })();
  </script>
</body>
</html>
`;

async function generateFavicon() {
  try {
    const { createCanvas } = await import("canvas");
    const size = 128;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    const radius = 30;

    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.arcTo(size, 0, size, size, radius);
    ctx.arcTo(size, size, 0, size, radius);
    ctx.arcTo(0, size, 0, 0, radius);
    ctx.arcTo(0, 0, size, 0, radius);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "#1e5eff");
    gradient.addColorStop(1, "#00a58f");
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 52px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("OF", size / 2, size / 2 + 2);
    ctx.restore();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.stroke();

    fs.writeFileSync(FAVICON_FILE, canvas.toBuffer("image/png"));
    console.log(`Favicon generated at: ${FAVICON_FILE}`);
  } catch (err) {
    console.warn(`Favicon generation skipped (canvas unavailable): ${err.message}`);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, "utf8");
console.log(`Index generated at: ${OUT_FILE}`);

await generateFavicon();

if (process.argv.includes("--check")) {
  const required = [
    esc(pkg.name),
    esc(pkg.version),
    `${SITE_BASE}/api/system/server/version/prd`,
    `${SITE_BASE}/api/system/api/agent_onboarding/prd`,
    esc(repoUrl),
    esc(issuesUrl),
  ];
  const missing = required.filter((token) => !html.includes(token));
  if (missing.length > 0) {
    console.error(`Validation failed. Missing in output: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Validation passed: generated index includes expected metadata and working links.");
}