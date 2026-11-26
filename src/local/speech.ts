// Speech to text, on this computer. Talqava runs whisper.cpp's small server (MIT, github.com/ggml-org/whisper.cpp)
// beside itself and hands it sound to write out. Nothing that is said leaves the computer, and it uses no AI model
// credit. Facts from whisper.cpp's own pages, read November 2026 (examples/server/README.md, README.md,
// models/README.md): the program is whisper-server; it takes --host, --port, -m (the model file), -t (threads) and
// -l (language, "auto" to detect); sound is sent to POST /inference as a form with the field "file" and
// response_format "json"; it is given WAV sound; the models are files named ggml-<name>.bin, kept on Hugging Face
// under ggerganov/whisper.cpp, each with a SHA-1 listed in models/README.md. Not stated there: the shape of the JSON
// answer (the words are read from its "text" field, as the program's own web page does), and a way to ask whether
// it is ready (the port is tried instead).
//
// The program is not part of the source: a build of Talqava brings it under vendor/whisper/<system>-<chip>/, or
// TALQAVA_WHISPER_SERVER names one. The model is downloaded the first time the owner asks, checked against its
// SHA-1, and kept in the data folder. The program is started when it is first needed, listens only on this computer,
// is given only sound Talqava has checked is plain WAV (so it never needs a converter), and is stopped after five
// quiet minutes to give its memory back.
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DATA, ROOT } from "./store.ts";

export interface SpeechModel {
  id: string;
  /** What the owner sees. */
  name: string;
  about: string;
  file: string;
  /** Size on disk in MB, and the memory it uses while working, as whisper.cpp's pages give them. */
  mb: number;
  memoryMb: number;
  sha1: string;
}
/** The models offered, smallest first. All understand many languages. */
export const SPEECH_MODELS: SpeechModel[] = [
  { id: "tiny", name: "Quick", about: "The smallest and fastest. Fine for clear speech in a quiet room; makes more mistakes with names and accents.", file: "ggml-tiny.bin", mb: 75, memoryMb: 273, sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f" },
  { id: "base", name: "Standard", about: "A good balance for everyday dictation and voice memos.", file: "ggml-base.bin", mb: 142, memoryMb: 388, sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac" },
  { id: "small", name: "Careful", about: "Slower, and better with names, accents and background noise. Good for meetings.", file: "ggml-small.bin", mb: 466, memoryMb: 852, sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5" },
];
const DEFAULT_MODEL = "base";
const dir = () => path.join(DATA, "speech");
const modelPath = (m: SpeechModel) => path.join(dir(), m.file);
const modelOf = (id: unknown): SpeechModel => {
  const m = SPEECH_MODELS.find((x) => x.id === id);
  if (!m) throw new Error("Choose a speech model from the list.");
  return m;
};
const chosenFile = () => path.join(dir(), "chosen.txt");
/** The model in use: the one the owner chose if it is here, else any that is here, else the standard one (not yet downloaded). */
function current(): SpeechModel {
  let chosen = "";
  try {
    chosen = fs.readFileSync(chosenFile(), "utf8").trim();
  } catch {}
  const have = SPEECH_MODELS.filter((m) => fs.existsSync(modelPath(m)));
  return have.find((m) => m.id === chosen) ?? have.find((m) => m.id === DEFAULT_MODEL) ?? have[0] ?? modelOf(DEFAULT_MODEL);
}

/** Where the whisper-server program is, or nothing when this copy of Talqava was built without it. */
export function programPath(): string | null {
  const named = (process.env.TALQAVA_WHISPER_SERVER ?? "").trim();
  const name = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
  for (const p of [named, path.join(ROOT, "vendor", "whisper", `${process.platform}-${process.arch}`, name)]) {
    try {
      if (p && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}
/** A whisper server that is already running somewhere on this computer (for tests, and for those who run their own). */
const givenAddress = () => {
  const v = (process.env.TALQAVA_WHISPER_URL ?? "").trim().replace(/\/+$/, "");
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(v) ? v : "";
};

// ---------- the model ----------
let download: { model: string; got: number; total: number; problem?: string } | null = null;
const modelsAddress = () => (process.env.TALQAVA_WHISPER_MODELS_URL || "https://huggingface.co/ggerganov/whisper.cpp/resolve/main").replace(/\/+$/, "");

/** Starts fetching a model in the background; `speechStatus` says how far it is. A file that does not match its SHA-1 is thrown away. */
export function fetchModel(id: unknown): { ok: true } {
  const m = modelOf(id);
  if (fs.existsSync(modelPath(m))) {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(chosenFile(), m.id);
    void stop();
    return { ok: true };
  }
  if (download && !download.problem) throw new Error("A speech model is already being downloaded. Wait for it to finish.");
  fs.mkdirSync(dir(), { recursive: true });
  let free = Infinity;
  try {
    const disk = fs.statfsSync(dir());
    free = disk.bavail * disk.bsize;
  } catch {}
  if (free < (m.mb + 200) * 1_000_000) throw new Error(`There is not enough free space on this computer for this model (${m.mb} MB).`);
  const state: NonNullable<typeof download> = { model: m.id, got: 0, total: m.mb * 1_048_576 };
  download = state;
  const part = `${modelPath(m)}.part`;
  void (async () => {
    try {
      const res = await fetch(`${modelsAddress()}/${m.file}`, { redirect: "follow", signal: AbortSignal.timeout(3_600_000) });
      if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}.`);
      const length = Number(res.headers.get("content-length"));
      if (length > 0) state.total = length;
      const hash = crypto.createHash("sha1");
      const out = fs.createWriteStream(part);
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        state.got += chunk.length;
        if (state.got > m.mb * 1_048_576 * 1.2 + 5_000_000) throw new Error("The download is larger than this model should be.");
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      if (hash.digest("hex") !== m.sha1) throw new Error("The downloaded file is not the one whisper.cpp lists (its checksum differs), so it was thrown away. Try again.");
      fs.renameSync(part, modelPath(m));
      fs.writeFileSync(chosenFile(), m.id);
      if (download === state) download = null;
      void stop();
    } catch (err) {
      fs.rmSync(part, { force: true });
      state.problem = (err as Error).name === "TimeoutError" ? "The download took more than an hour and was stopped. Try again on a faster connection." : (err as Error).message || "The download did not finish.";
    }
  })();
  return { ok: true };
}

/** Removes a downloaded model. */
export async function removeModel(id: unknown): Promise<{ ok: true }> {
  const m = modelOf(id);
  await stop();
  fs.rmSync(modelPath(m), { force: true });
  return { ok: true };
}

/** What the app shows: whether speech can be written out here, which model is used, and a download under way. */
export function speechStatus() {
  const can = Boolean(givenAddress() || programPath());
  const model = current();
  const have = fs.existsSync(modelPath(model));
  return {
    // "ready": press and speak. "needs-model": one download first. "unavailable": this copy of Talqava has no speech program.
    state: !can ? ("unavailable" as const) : givenAddress() || have ? ("ready" as const) : ("needs-model" as const),
    model: model.id,
    models: SPEECH_MODELS.map((m) => ({ id: m.id, name: m.name, about: m.about, mb: m.mb, memoryMb: m.memoryMb, here: fs.existsSync(modelPath(m)) })),
    download: download ? { model: download.model, percent: Math.min(99, Math.floor((download.got / Math.max(1, download.total)) * 100)), problem: download.problem ?? null } : null,
    running: Boolean(running),
  };
}

// ---------- the program ----------
let running: { child: ChildProcess; address: string; model: string } | null = null;
let starting: Promise<string> | null = null;
let idle: NodeJS.Timeout | null = null;
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.setTimeout(1000, () => (s.destroy(), resolve(false)));
  });

/** Stops the program, if it is running. */
export async function stop(): Promise<void> {
  if (idle) clearTimeout(idle);
  idle = null;
  const was = running;
  running = null;
  if (!was || was.child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    was.child.once("exit", () => resolve());
    was.child.kill();
    setTimeout(() => (was.child.exitCode === null && was.child.kill("SIGKILL"), resolve()), 3000).unref();
  });
}
process.once("exit", () => running?.child.kill());

/** The address of the running program, starting it when it is not. */
async function address(): Promise<string> {
  const given = givenAddress();
  if (given) return given;
  const model = current();
  if (running && running.child.exitCode === null && running.model === model.id) return running.address;
  if (starting) return starting;
  starting = (async () => {
    await stop();
    const program = programPath();
    if (!program) throw new Error("This copy of Talqava cannot write out speech: it was built without the speech program.");
    if (!fs.existsSync(modelPath(model))) throw new Error("The speech model is not downloaded yet.");
    const port = await freePort();
    // Half the processor's cores, at most eight: quick, and the computer stays usable meanwhile.
    const threads = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
    const child = spawn(program, ["--host", "127.0.0.1", "--port", String(port), "-m", modelPath(model), "-l", "auto", "-t", String(threads)], { cwd: dir(), stdio: ["ignore", "ignore", "pipe"], env: { PATH: "/usr/bin:/bin" } });
    let said = "";
    child.stderr?.on("data", (d: Buffer) => (said = (said + d.toString()).slice(-2000)));
    const died = new Promise<never>((_, reject) => child.once("exit", (code) => reject(new Error(`The speech program stopped while starting${code === null ? "" : ` (code ${code})`}. ${said.split("\n").filter(Boolean).slice(-2).join(" ")}`.trim()))));
    child.once("error", () => {});
    const up = (async () => {
      // A large model takes a while to load.
      for (let i = 0; i < 240; i++) {
        if (await listening(port)) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("The speech program did not start within a minute.");
    })();
    try {
      await Promise.race([up, died]);
    } catch (err) {
      child.kill();
      throw err;
    }
    died.catch(() => {});
    child.once("exit", () => running?.child === child && (running = null));
    running = { child, address: `http://127.0.0.1:${port}`, model: model.id };
    return running.address;
  })().finally(() => (starting = null));
  return starting;
}

// ---------- writing out ----------
/** Twenty minutes of the plain sound the program takes: one channel, 16,000 samples a second, 16 bits each. */
export const MAX_WAV = 16_000 * 2 * 60 * 20 + 1024;

/** Checks that sound is plain WAV of the one kind the program takes, and says how long it is. Anything else is refused. */
export function checkWav(wav: Buffer): { seconds: number } {
  const bad = () => new Error("That sound could not be read. Record it again.");
  if (wav.length < 44 || wav.toString("latin1", 0, 4) !== "RIFF" || wav.toString("latin1", 8, 12) !== "WAVE") throw bad();
  if (wav.length > MAX_WAV) throw new Error("That recording is longer than twenty minutes. Write out a shorter one.");
  let at = 12;
  let format: { kind: number; channels: number; rate: number; bits: number } | null = null;
  while (at + 8 <= wav.length) {
    const id = wav.toString("latin1", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "fmt " && size >= 16 && at + 24 <= wav.length) format = { kind: wav.readUInt16LE(at + 8), channels: wav.readUInt16LE(at + 10), rate: wav.readUInt32LE(at + 12), bits: wav.readUInt16LE(at + 22) };
    if (id === "data") {
      if (!format || format.kind !== 1 || format.channels !== 1 || format.rate !== 16_000 || format.bits !== 16) throw bad();
      const bytes = Math.min(size, wav.length - at - 8);
      if (bytes < 3200) throw new Error("That recording is too short to write out. Speak for a moment longer.");
      return { seconds: Math.round(bytes / 32_000) };
    }
    at += 8 + size + (size % 2);
  }
  throw bad();
}

let busy: Promise<unknown> = Promise.resolve();
/** Writes out what is said in a recording. One at a time: the program does one piece of sound after another. */
export function transcribe(wav: Buffer): Promise<{ text: string; seconds: number }> {
  const { seconds } = checkWav(wav);
  const run = busy.then(async () => {
    const base = await address();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
    form.append("response_format", "json");
    form.append("temperature", "0.0");
    let res: Response;
    try {
      // Writing out takes a fraction of the recording's length on most computers; this allows a slow one several times it.
      res = await fetch(`${base}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000 + seconds * 4000) });
    } catch (err) {
      if (!givenAddress()) await stop();
      throw new Error((err as Error).name === "TimeoutError" ? "Writing it out took too long and was stopped. Try a shorter recording, or the Quick model." : "The speech program stopped answering. Try again.");
    }
    const answer = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (!res.ok || !answer || typeof answer.text !== "string") throw new Error(`The speech program could not write that out${typeof answer?.error === "string" ? `: ${answer.error.slice(0, 200)}` : "."}`);
    // The program marks silence and noises in square brackets or round ones; those are not words anyone said.
    const text = answer.text.replace(/\r\n?/g, "\n").replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|SOUND|INAUDIBLE|SILENCE)[^\]]*\]|\((?:music|silence|inaudible)[^)]*\)/gi, " ").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim().slice(0, 200_000);
    if (!givenAddress()) {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => void stop(), 300_000);
      idle.unref();
    }
    return { text, seconds };
  });
  busy = run.catch(() => {});
  return run;
}
