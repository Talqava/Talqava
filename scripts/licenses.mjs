#!/usr/bin/env node
// Talqava's open-source licence check (see legal/OPEN_SOURCE_POLICY.md).
//
// Lists every third-party component that ships with Talqava, with its licence, and:
//   - fails if any has a licence the policy does not allow, or no licence at all;
//   - writes THIRD_PARTY_NOTICES.md (everything shipped, with each licence's full text);
//   - writes public/vendor/editor.LICENSES.txt (the notices for the bundled page editor, which ships as one file).
//
//   npm run licenses            check and rewrite the notices
//   npm run licenses -- --check check only; fail if the notices are out of date
//
// What ships: the app's runtime dependencies (not its development tools), the packages bundled into the page editor,
// and the bundled fonts. Electron and Chromium bring their own licence files into the Mac app.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CHECK = process.argv.includes("--check");

// The policy, by SPDX identifier.
const ALLOWED = new Set(["MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Zlib", "OFL-1.1"]);
const REVIEW = new Set(["MPL-2.0", "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later", "EPL-2.0", "CC-BY-4.0", "CC-BY-3.0", "Python-2.0", "Artistic-2.0"]);
/** Packages the maintainers reviewed and approved despite a licence that needs review, with the reason. */
const APPROVED = {};

/**
 * Packages that declare a licence but ship no licence file. For each, the maintainers checked the package's own
 * repository and record here the copyright holder it names; the notice is the standard text of the declared licence.
 */
const SUPPLIED = {
  standardwebhooks: {
    holder: "Standard Webhooks",
    source: "https://github.com/standard-webhooks/standard-webhooks",
  },
};
const MIT_TEXT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** Whether an SPDX expression is allowed: "A OR B" needs one allowed side, "A AND B" needs both. */
function verdict(expr) {
  const clean = String(expr || "").replace(/[()]/g, "").trim();
  if (!clean || /^(UNLICENSED|SEE LICENSE IN)/i.test(clean)) return "missing";
  if (/ OR /.test(clean)) return clean.split(/ OR /).map((x) => verdict(x)).sort((a, b) => ["allowed", "review", "missing", "forbidden"].indexOf(a) - ["allowed", "review", "missing", "forbidden"].indexOf(b))[0];
  if (/ AND /.test(clean)) return clean.split(/ AND /).map((x) => verdict(x)).sort((a, b) => ["forbidden", "missing", "review", "allowed"].indexOf(a) - ["forbidden", "missing", "review", "allowed"].indexOf(b))[0];
  if (ALLOWED.has(clean)) return "allowed";
  if (REVIEW.has(clean)) return "review";
  return "forbidden";
}

/**
 * "The package says MIT" does not mean every file in it is MIT. These find what a package carries besides its main
 * licence: licence or notice files further down (vendored code), and compiled binaries, which can bundle other code.
 */
function innerFiles(dir) {
  const licences = [];
  const binaries = [];
  const walk = (at, depth) => {
    if (depth > 8 || !fs.existsSync(at)) return;
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(at, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (depth > 0 ? /^(licen[cs]e|copying|notice)([._-]|$)/i.test(e.name) : /^(licen[cs]e|copying|notice)_/i.test(e.name)) licences.push(full);
      else if (/\.(node|wasm|dylib|so|dll|exe)$/i.test(e.name)) binaries.push(full);
    }
  };
  walk(dir, 0);
  return { licences, binaries };
}

/** What a licence text is, read from its words rather than its label. */
function kindOfText(text) {
  const t = text.replace(/\s+/g, " ");
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return "AGPL";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t) && !/GNU GENERAL PUBLIC LICENSE\s+Version/i.test(t)) return "LGPL";
  if (/GNU (LIBRARY )?GENERAL PUBLIC LICENSE|General Public License v\.?\s?2/i.test(t)) return "GPL";
  if (/Mozilla Public License/i.test(t)) return "MPL-2.0";
  if (/Apache License,? Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/Permission to use, copy, modify, and\/or distribute/i.test(t)) return "ISC";
  if (/Redistribution and use in source and binary forms/i.test(t)) return "BSD-3-Clause";
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return "Unlicense";
  if (/SIL OPEN FONT LICENSE/i.test(t)) return "OFL-1.1";
  if (/CC0 1\.0 Universal/i.test(t)) return "CC0-1.0";
  if (/zlib/i.test(t) && /altered source versions must be plainly marked/i.test(t)) return "Zlib";
  return "";
}

/** Inner licence files and binaries the maintainers looked at and approved, by package, with the reason. */
const INNER_APPROVED = {
  // Reviewed 2026-11-24: each WebAssembly module ships with its licences beside it in wasm/, all permissive:
  // JBIG2 (PDFium, BSD-3-Clause; Mozilla's wrapper Apache-2.0), OpenJPEG (BSD-2-Clause; wrapper BSD), qcms (MIT),
  // QuickJS (MIT). Their texts are carried into the notices with the package.
  "pdfjs-dist": ["wasm/jbig2.wasm", "wasm/openjpeg.wasm", "wasm/qcms_bg.wasm", "wasm/quickjs-eval.wasm"],
};

const licenseOf = (pkg) => (typeof pkg.license === "string" ? pkg.license : pkg.license?.type) || (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type || l).join(" OR ") : "");

/** A package's licence text and its first copyright line, from the files it ships. */
function textOf(dir) {
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|-|$)/i.test(f)) : null;
  const text = file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : "";
  const notice = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^notice(\.|$)/i.test(f)) : null;
  return { text, copyright: (text.split("\n").find((l) => /copyright/i.test(l)) ?? "").trim(), notice: notice ? fs.readFileSync(path.join(dir, notice), "utf8").trim() : "" };
}

/**
 * The app's runtime dependencies, every level deep. Development tools are not shipped, and neither are optional
 * extras: Talqava is installed with --omit=optional everywhere it ships (the Mac app, the installer, Docker).
 */
function appPackages() {
  const out = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: ROOT, encoding: "utf8" });
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")).packages ?? {};
  const optional = new Set(Object.entries(lock).filter(([, p]) => p.optional || p.devOptional && p.dev).map(([where]) => path.join(ROOT, where)));
  return out.split("\n").slice(1).filter(Boolean).filter((dir) => !optional.has(dir)).map((dir) => ({ dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) }));
}

/** The packages bundled into public/vendor/editor.js, found by bundling it again with a record of its inputs. */
function editorPackages() {
  const editor = path.join(ROOT, "editor");
  const list = path.join(editor, "bundled-packages.json");
  const esbuild = path.join(editor, "node_modules", ".bin", "esbuild");
  if (!fs.existsSync(esbuild)) {
    // Without the editor's tools installed, trust the list recorded at its last build.
    return JSON.parse(fs.readFileSync(list, "utf8")).map((p) => ({ dir: path.join(editor, "node_modules", p.name), pkg: p, recorded: true }));
  }
  const meta = path.join(editor, ".bundle-meta.json");
  execFileSync(esbuild, ["src/editor.js", "--bundle", "--format=esm", `--metafile=${meta}`, "--outfile=/dev/null", "--log-level=error"], { cwd: editor });
  const names = new Set();
  for (const input of Object.keys(JSON.parse(fs.readFileSync(meta, "utf8")).inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
    if (m) names.add(m[1]);
  }
  fs.rmSync(meta, { force: true });
  const found = [...names].sort().map((name) => {
    const dir = path.join(editor, "node_modules", name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return { dir, pkg };
  });
  const recorded = `${JSON.stringify(found.map(({ pkg }) => ({ name: pkg.name, version: pkg.version, license: licenseOf(pkg) })), null, 2)}\n`;
  if (!CHECK) fs.writeFileSync(list, recorded);
  return found;
}

/** The fonts bundled in public/fonts, under the SIL Open Font License. */
function fonts() {
  const dir = path.join(ROOT, "public", "fonts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^OFL-.*\.txt$/.test(f)).map((f) => {
    const text = fs.readFileSync(path.join(dir, f), "utf8").trim();
    return { name: f.replace(/^OFL-|\.txt$/g, "").replace(/([a-z])([A-Z])/g, "$1 $2"), version: "", license: "OFL-1.1", text, copyright: text.split("\n").find((l) => /copyright/i.test(l)) ?? "", notice: "", where: "public/fonts" };
  });
}

const entry = ({ dir, pkg }, where) => {
  const found = textOf(dir);
  const supplied = !found.text && SUPPLIED[pkg.name] && licenseOf(pkg) === "MIT" ? SUPPLIED[pkg.name] : null;
  if (supplied) return { name: pkg.name, version: pkg.version, license: licenseOf(pkg), text: `${MIT_TEXT(supplied.holder)}\n\n(The package declares the MIT licence but ships no licence file. This is the standard MIT text, with the copyright holder named by the package; source: ${supplied.source}.)`, copyright: `Copyright (c) ${supplied.holder}`, notice: "", where };
  const inner = innerFiles(dir);
  const extra = inner.licences.map((file) => ({ file: path.relative(dir, file), text: fs.readFileSync(file, "utf8").trim() })).map((x) => ({ ...x, kind: kindOfText(x.text) }));
  return { name: pkg.name, version: pkg.version, license: licenseOf(pkg), ...found, where, extra, binaries: inner.binaries.map((b) => path.relative(dir, b)) };
};
const app = appPackages().map((p) => entry(p, "app"));
const editor = editorPackages().map((p) => entry(p, "editor"));
const all = [...app, ...editor, ...fonts()];

// ---- the check ----
const problems = [];
for (const c of all) {
  const v = verdict(c.license);
  if (v === "allowed") continue;
  if (v === "review" && APPROVED[c.name]) continue;
  problems.push(`${c.name}@${c.version} (${c.where}): ${c.license || "no licence"} is ${v === "review" ? "a licence that needs the maintainers' review" : v === "missing" ? "missing" : "not allowed by the policy"}`);
}
for (const c of all) if (!c.text && !c.where.startsWith("public")) problems.push(`${c.name}@${c.version} (${c.where}): ships no licence file, so its notice cannot be kept`);
// Files inside a package under another licence, and binaries, each need a look before they ship.
for (const c of all) {
  const ok = INNER_APPROVED[c.name] ?? [];
  for (const x of c.extra ?? []) {
    const v = x.kind ? verdict(x.kind) : "review";
    if (v === "allowed" || ok.includes(x.file)) continue;
    problems.push(`${c.name}@${c.version} (${c.where}): ${x.file} is ${x.kind || "a licence the check cannot recognise"}, ${v === "forbidden" ? "which the policy does not allow" : "which needs the maintainers' review"}`);
  }
  for (const b of c.binaries ?? []) if (!ok.includes(b)) problems.push(`${c.name}@${c.version} (${c.where}): ships a compiled binary, ${b}; check what it contains (look for a bill of materials) and record it in INNER_APPROVED`);
}

// ---- the notices ----
const block = (c) => [`### ${c.name}${c.version ? ` ${c.version}` : ""}`, "", `Licence: ${c.license}${c.copyright ? `  \n${c.copyright}` : ""}`, "", "```text", c.text || `Licensed under ${c.license}.`, "```", c.notice ? ["", "NOTICE:", "", "```text", c.notice, "```"].join("\n") : "", ...(c.extra ?? []).map((x) => ["", `Also in this package, ${x.file}${x.kind ? ` (${x.kind})` : ""}:`, "", "```text", x.text, "```"].join("\n"))].filter((x) => x !== "").join("\n");
const count = (list) => Object.entries(list.reduce((n, c) => ((n[c.license] = (n[c.license] ?? 0) + 1), n), {})).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n} ${l}`).join(", ");
// Public data the app downloads while it runs (nothing of it ships in the app); credited like the components.
/** The speech program: built from whisper.cpp's source and placed beside the app in builds that write out speech. */
const SPEECH = [
  {
    name: "whisper.cpp (the whisper-server program, from github.com/ggml-org/whisper.cpp; in builds that write out speech)",
    license: "MIT",
    copyright: "Copyright (c) 2023-2026 The ggml authors",
    text: MIT_TEXT("2023-2026 The ggml authors"),
  },
];
/** Code adapted from other projects into Talqava's own files. Each entry says which files carry it. */
const ADAPTED = [
  {
    name: "OpenClaw (github.com/openclaw/openclaw): the interaction-layer colour tokens in public/shell.css, adapted from ui/src/styles/base.css",
    license: "MIT",
    copyright: "Copyright (c) 2026 OpenClaw Foundation",
    text: MIT_TEXT("2026 OpenClaw Foundation"),
  },
];
const RUNTIME_DATA = [
  {
    name: "LiteLLM model prices and context windows (model_prices_and_context_window.json, from github.com/BerriAI/litellm)",
    license: "MIT",
    copyright: "Copyright (c) 2023 Berri AI",
    text: `MIT License

Copyright (c) 2023 Berri AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
];

const notices = [
  "# Third-party notices",
  "",
  "Talqava is MIT-licensed. It ships with the open-source components below, each under its own licence, whose terms we keep. This file is generated by `npm run licenses` from what actually ships; do not edit it by hand. Our policy for third-party components is in [legal/OPEN_SOURCE_POLICY.md](legal/OPEN_SOURCE_POLICY.md).",
  "",
  "The Mac app is built with Electron, which adds its own licence and Chromium's (`LICENSE.electron.txt` and `LICENSES.chromium.html`) to the app.",
  "",
  `## The app's runtime components (${app.length}: ${count(app)})`,
  "",
  ...app.map(block).flatMap((b) => [b, ""]),
  `## Bundled into the page editor, public/vendor/editor.js (${editor.length}: ${count(editor)})`,
  "",
  ...editor.map(block).flatMap((b) => [b, ""]),
  "## Fonts, in public/fonts",
  "",
  ...fonts().map(block).flatMap((b) => [b, ""]),
  "## The speech program",
  "",
  "Talqava writes out speech with whisper.cpp, run as a separate program on the owner's computer. The speech model it uses is not part of Talqava: the owner downloads it from the whisper.cpp project's own files the first time they use speech.",
  "",
  ...SPEECH.map(block).flatMap((b) => [b, ""]),
  "## Code adapted from other projects",
  "",
  "Small parts of these projects were adapted into Talqava's own files. Their names, logos and artwork are not used.",
  "",
  ...ADAPTED.map(block).flatMap((b) => [b, ""]),
  "## Data read while the app runs",
  "",
  ...RUNTIME_DATA.map(block).flatMap((b) => [b, ""]),
].join("\n");
const editorNotices = [
  "Talqava page editor (public/vendor/editor.js)",
  "",
  "This file bundles the open-source components below. Each keeps its copyright and licence, reproduced here.",
  "Generated by `npm run licenses`.",
  "",
  ...editor.map((c) => [`== ${c.name} ${c.version} (${c.license}) ==`, "", c.text, c.notice ? `\nNOTICE:\n${c.notice}` : "", ""].join("\n")),
].join("\n");

const files = [
  [path.join(ROOT, "THIRD_PARTY_NOTICES.md"), `${notices.trimEnd()}\n`],
  [path.join(ROOT, "public", "vendor", "editor.LICENSES.txt"), `${editorNotices.trimEnd()}\n`],
];
let stale = false;
for (const [file, text] of files) {
  const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
  if (CHECK && !same) {
    stale = true;
    problems.push(`${path.relative(ROOT, file)} is out of date: run npm run licenses`);
  }
  if (!CHECK && !same) fs.writeFileSync(file, text);
}

console.log(`Shipped components: ${app.length} in the app (${count(app)}), ${editor.length} in the page editor (${count(editor)}), ${fonts().length} fonts.`);
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(CHECK ? "Every licence is allowed and the notices are up to date." : "Every licence is allowed. Notices written to THIRD_PARTY_NOTICES.md and public/vendor/editor.LICENSES.txt.");
void stale;
