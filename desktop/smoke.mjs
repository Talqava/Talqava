// Starts the packaged app's own server, the way the app does, and checks that it answers. Used by the build
// workflow on Windows and Linux, where nobody opens the window: it proves the packaged server runs there, not that
// the whole app has been tried by a person.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const candidates = [
  [path.join(dist, "win-unpacked", "Talqava.exe"), path.join(dist, "win-unpacked", "resources", "server")],
  [path.join(dist, "linux-unpacked", "talqava"), path.join(dist, "linux-unpacked", "resources", "server")],
  [path.join(dist, "mac-arm64", "Talqava.app", "Contents", "MacOS", "Talqava"), path.join(dist, "mac-arm64", "Talqava.app", "Contents", "Resources", "server")],
];
const found = candidates.find(([exe]) => fs.existsSync(exe));
if (!found) {
  console.error(`No packaged app was found under ${dist}. Build it first.`);
  process.exit(1);
}
const [exe, serverDir] = found;
const port = 8950 + Math.floor(Math.random() * 40);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-smoke-"));
const child = spawn(exe, [path.join(serverDir, "src", "local", "main.ts")], {
  cwd: serverDir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", TALQAVA_DATA_DIR: data, HOST: "127.0.0.1", PORT: String(port) },
  stdio: ["ignore", "inherit", "inherit"],
});
let exited = null;
child.once("exit", (code) => (exited = code ?? -1));

const stop = (code) => {
  if (exited === null) child.kill();
  setTimeout(() => process.exit(code), 500);
};
for (let i = 0; i < 150; i++) {
  if (exited !== null) {
    console.error(`The packaged server stopped while starting (code ${exited}).`);
    process.exit(1);
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const state = await res.json();
      console.log(`The packaged server answers on ${process.platform}: ${Object.keys(state).length} settings returned.`);
      stop(0);
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
  if (i === 149) {
    console.error("The packaged server did not answer within 30 seconds.");
    stop(1);
  }
}
