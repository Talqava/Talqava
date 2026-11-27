// Starts the local edition: npm start, or the talqava command the installer adds.
//   --open   also open the app in the browser once it is ready
import { execFile } from "node:child_process";
import { start } from "./server.ts";

const server = start();

if (process.argv.includes("--open")) {
  server.once("listening", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 8787;
    const url = `http://localhost:${port}`;
    const [command, args] =
      process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    // If no browser can be opened (a server, a terminal-only machine), the address printed above is enough.
    execFile(command, args, () => {});
  });
}

// Inside a desktop app, the app starts this server and stops it on Quit. If the app is force-quit or crashes, nobody
// is left to stop it, and it would hold its port and its data. So it watches for the app going away (its parent
// changes) and then stops by itself.
if (process.env.TALQAVA_DESKTOP) {
  // The app asks it to stop with a signal. The app itself sets that signal aside for its own use, and a program
  // started by it would otherwise inherit that and never hear the request.
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => process.exit(0));
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) process.exit(0);
  }, 3000).unref();
}
