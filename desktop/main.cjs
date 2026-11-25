// Talqava for the desktop (Mac, and builds for Windows and Linux). Starts the app's own server in the background, then
// shows it in a window. Closing the window keeps it running (so scheduled jobs
// and bots carry on); Quit from the menu or Dock stops everything.
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const NAME = "Talqava";
const FIRST_PORT = 8788; // 8787 is left for the web version, so both can run at once
const HOST = "127.0.0.1";

app.setName(NAME);
if (!app.requestSingleInstanceLock()) app.quit();

const serverDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.resolve(__dirname, "..");
// Where everything is kept. The app was called "Talqava Agents" before; data made then stays in that folder.
const oldDataDir = path.join(app.getPath("appData"), "Talqava Agents", "data");
const dataDir = fs.existsSync(oldDataDir) ? oldDataDir : path.join(app.getPath("userData"), "data"); // ~/Library/Application Support/Talqava/data
const logFile = path.join(app.getPath("logs"), "server.log");

let server = null;
let url = null;
let win = null;
let quitting = false;

// ---------- the server ----------
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function choosePort() {
  for (let port = FIRST_PORT; port < FIRST_PORT + 50; port++) if (await portIsFree(port)) return port;
  throw new Error("No free port was found between 8788 and 8837.");
}

function answers(address) {
  return new Promise((resolve) => {
    const req = http.get(`${address}/api/state`, (res) => (res.resume(), resolve(true)));
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => (req.destroy(), resolve(false)));
  });
}

function lastLogLines() {
  try {
    return fs.readFileSync(logFile, "utf8").trim().split("\n").slice(-12).join("\n");
  } catch {
    return "";
  }
}

async function startServer() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const port = await choosePort();
  const log = fs.createWriteStream(logFile, { flags: "a" });
  log.write(`\n--- ${new Date().toISOString()} starting on port ${port} ---\n`);
  // Apps opened from Finder or the Start menu get a bare PATH; add the usual places for tools the agent's shell uses.
  // On Windows that is Git for Windows, which brings the bash shell the agents' shell tool runs commands in.
  const extra =
    process.platform === "win32"
      ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin"), ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin")] : [])]
      : ["/opt/homebrew/bin", "/usr/local/bin", path.join(app.getPath("home"), ".local", "bin")];
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1", // run the bundled Electron as plain Node.js
    TALQAVA_DATA_DIR: dataDir,
    HOST,
    PORT: String(port),
    PATH: [...extra, process.env.PATH || (process.platform === "win32" ? "" : "/usr/bin:/bin:/usr/sbin:/sbin")].filter(Boolean).join(path.delimiter),
  };
  server = spawn(process.execPath, [path.join(serverDir, "src", "local", "main.ts")], { cwd: serverDir, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.once("exit", (code) => {
    server = null;
    if (!quitting) serverStopped(code);
  });
  const address = `http://${HOST}:${port}`;
  for (let i = 0; i < 150; i++) {
    if (!server) throw new Error(`The app stopped while starting.\n\n${lastLogLines()}`);
    if (await answers(address)) return address;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`The app did not start within 30 seconds.\n\n${lastLogLines()}`);
}

async function serverStopped(code) {
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: `${NAME} stopped unexpectedly (code ${code}).`,
    detail: lastLogLines() || "No details were written.",
    buttons: ["Restart", "Show Log", "Quit"],
  });
  if (response === 1) shell.showItemInFolder(logFile);
  if (response === 2) return app.quit();
  await launch();
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    const force = setTimeout(() => s.kill("SIGKILL"), 4000);
    s.once("exit", () => (clearTimeout(force), resolve()));
    s.kill("SIGTERM");
  });
}

// ---------- the window ----------
function isOurs(target) {
  try {
    return new URL(target).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

function showWindow() {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  if (!url) return;
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 600,
    title: NAME,
    backgroundColor: "#f3f5f3", // the light theme is the default; the page then follows the theme chosen in Settings
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, plugins: true }, // plugins: the built-in PDF viewer, for previews in the library
  });
  win.loadURL(url);
  win.once("ready-to-show", () => win.show());
  // Links to other sites open in the person's own browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target) && !isOurs(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!isOurs(target)) {
      e.preventDefault();
      if (/^https?:/.test(target)) shell.openExternal(target);
    }
  });
  // Closing the window hides it; the app keeps running until Quit.
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => (win = null));
}

// ---------- the menu ----------
function buildMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: NAME,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Open at Login",
            type: "checkbox",
            checked: openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
          { label: "Show Data Folder", click: () => shell.openPath(dataDir) },
          { label: "Show Log", click: () => shell.showItemInFolder(logFile) },
          // Hide, Hide Others and Show All exist only on a Mac.
          ...(process.platform === "darwin" ? [{ type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }] : []),
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { label: "Talqava User Guide", accelerator: "CmdOrCtrl+?", click: () => showGuide("getting-started") },
          { type: "separator" },
          ...[
            ["Terms of Use", "terms"],
            ["Privacy Policy", "privacy"],
            ["Acceptable Use Policy", "acceptable-use"],
            ["Licence", "license"],
            ["Third-party Notices", "notices"],
          ].map(([label, id]) => ({ label, click: () => showLegal(id) })),
          { type: "separator" },
          { label: "Talqava Website", click: () => shell.openExternal("https://talqava.com") },
          { label: "Report a Problem", click: () => shell.openExternal("https://github.com/Talqava/Talqava/issues/new/choose") },
        ],
      },
    ]),
  );
}

/** Opens one of the app's documents (terms, privacy policy, licence…) in the window. */
function showLegal(id) {
  showWindow();
  win?.webContents.executeJavaScript(`window.talqavaShowLegal && window.talqavaShowLegal(${JSON.stringify(id)})`).catch(() => {});
}

/** Opens the user guide in the window. */
function showGuide(id) {
  showWindow();
  win?.webContents.executeJavaScript(`window.talqavaShowGuide && window.talqavaShowGuide(${JSON.stringify(id)})`).catch(() => {});
}

// ---------- start and stop ----------
async function launch() {
  try {
    url = await startServer();
    showWindow();
  } catch (err) {
    await dialog.showMessageBox({ type: "error", message: `${NAME} could not start.`, detail: String(err.message || err) });
    app.quit();
  }
}

app.on("second-instance", showWindow);
app.on("activate", showWindow); // clicking the Dock icon brings the window back

app.on("before-quit", (e) => {
  if (quitting && !server) return;
  quitting = true;
  if (server) {
    e.preventDefault();
    stopServer().then(() => app.quit());
  }
});

app.whenReady().then(() => {
  buildMenu();
  launch();
});
