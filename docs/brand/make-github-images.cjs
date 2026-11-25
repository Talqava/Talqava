// Draws the images GitHub shows for Talqava from the official logo: the organization picture (500 px square) and
// the repository's social preview (1280 x 640, the size GitHub asks for). Run from app/desktop:
//   npx electron ../docs/brand/make-github-images.cjs
// GitHub has no API for either, so both are uploaded by hand (see docs/brand/README.md).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "github");
const fonts = path.join(__dirname, "..", "..", "public", "fonts");
const font = (file) => `url("data:font/woff2;base64,${fs.readFileSync(path.join(fonts, file)).toString("base64")}") format("woff2")`;

// The mark's T, without its tile: GitHub rounds the picture's corners itself, so the black fills the whole square.
const avatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="500" height="500"><rect width="64" height="64" fill="#0A0A0A"/><rect x="14" y="16" width="36" height="8" fill="#F2F2F2"/><rect x="27" y="28" width="10" height="20" fill="#00D26A"/></svg>`;

const lockup = fs.readFileSync(path.join(__dirname, "logos", "talqava-lockup-dark.svg"), "utf8").replace('width="348" height="64"', 'width="609" height="112"');

const social = `<html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: ${font("inter-latin-wght-normal.woff2")}; font-weight: 100 900; }
@font-face { font-family: "Space Grotesk"; src: ${font("space-grotesk-latin-wght-normal.woff2")}; font-weight: 300 700; }
body { margin: 0; width: 1280px; height: 640px; background: #0A0A0A; color: #F2F2F2; font-family: Inter, sans-serif; overflow: hidden; position: relative; }
.glow { position: absolute; inset: 0; background: radial-gradient(ellipse 60% 70% at 50% 115%, rgba(0, 210, 106, 0.22), transparent 70%); }
.grid { position: absolute; inset: 0; background-image: linear-gradient(#141414 1px, transparent 1px), linear-gradient(90deg, #141414 1px, transparent 1px); background-size: 40px 40px; opacity: 0.6; }
.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; }
h1 { margin: 0; font-family: "Space Grotesk", Inter, sans-serif; font-weight: 600; font-size: 52px; letter-spacing: -0.5px; }
h1 b { color: #00D26A; font-weight: 600; }
p { margin: 0; font-size: 24px; color: #B8B8B8; letter-spacing: 0.2px; }
</style></head><body><div class="grid"></div><div class="glow"></div><div class="wrap">${lockup}<h1>Run your organization with <b>AI agents</b></h1><p>Open source · MIT licence · talqava.com</p></div></body></html>`;

async function shoot(html, width, height, file) {
  const win = new BrowserWindow({ width, height, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 1 } });
  const page = path.join(out, `_${file}.html`);
  fs.writeFileSync(page, html);
  // A page that loads fonts can report an aborted first load; it still finishes loading.
  await win.loadFile(page).catch(() => new Promise((r) => win.webContents.once("did-finish-load", r)));
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  await new Promise((r) => setTimeout(r, 400));
  const image = (await win.webContents.capturePage({ x: 0, y: 0, width, height })).resize({ width, height });
  fs.writeFileSync(path.join(out, file), image.toPNG());
  fs.rmSync(page);
  win.destroy();
  console.log(`Wrote ${file}`);
}

app.disableHardwareAcceleration();
// Closing one picture's window must not end the app before the next is drawn.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  await shoot(`<html><body style="margin:0;background:#0A0A0A">${avatar}</body></html>`, 500, 500, "talqava-org-avatar.png");
  await shoot(social, 1280, 640, "talqava-social-preview.png");
  app.quit();
});
