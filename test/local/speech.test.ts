// Speech to text on this computer: the sound is checked, the model is downloaded once and checked against its
// checksum, and the speech program is started when needed. Against a stand-in program, never the real one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-speech-"));
process.env.TALQAVA_DATA_DIR = data;
let S: typeof import("../../src/local/speech.ts");
let models: http.Server;

/** Plain sound of the one kind the program takes: one channel, 16,000 samples a second, 16 bits. */
const wav = (seconds: number, { rate = 16_000, channels = 1, bits = 16 } = {}) => {
  const bytes = Math.floor(seconds * rate * channels * (bits / 8));
  const b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8, "latin1");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * (bits / 8), 28);
  b.writeUInt16LE(channels * (bits / 8), 32);
  b.writeUInt16LE(bits, 34);
  b.write("data", 36, "latin1");
  b.writeUInt32LE(bytes, 40);
  return b;
};

// A stand-in for whisper-server: it takes the same options, answers POST /inference with the words, and says in
// its answer which model file and language it was started with.
const program = path.join(data, "whisper-server");
fs.writeFileSync(
  program,
  `#!${process.execPath}
const http = require("node:http");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!require("node:fs").existsSync(arg("-m"))) { console.error("no model"); process.exit(3); }
http.createServer((req, res) => {
  let size = 0;
  req.on("data", (c) => (size += c.length));
  req.on("end", () => {
    const form = String(req.headers["content-type"]).startsWith("multipart/form-data");
    if (req.method !== "POST" || req.url !== "/inference" || !form) return res.writeHead(404).end("{}");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: " [BLANK_AUDIO] Order  two loaves\\n for Friday. (music)\\n", model: require("node:path").basename(arg("-m")), language: arg("-l"), host: arg("--host"), size }));
  });
}).listen(Number(arg("--port")), arg("--host"));
`,
);
fs.chmodSync(program, 0o755);

before(async () => {
  models = http.createServer((req, res) => {
    if (req.url === "/ggml-tiny.bin") return res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.alloc(4096, 7));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => models.listen(0, "127.0.0.1", r));
  process.env.TALQAVA_WHISPER_MODELS_URL = `http://127.0.0.1:${(models.address() as AddressInfo).port}`;
  S = await import("../../src/local/speech.ts");
});
after(async () => {
  await S.stop();
  models.close();
});

test("only plain sound of the one kind the program takes is accepted, and at most twenty minutes of it", () => {
  assert.deepEqual(S.checkWav(wav(3)), { seconds: 3 });
  for (const [what, sound] of [["stereo", wav(1, { channels: 2 })], ["another rate", wav(1, { rate: 44_100 })], ["8 bits", wav(1, { bits: 8 })], ["not sound", Buffer.from("GIF89a" + "x".repeat(100))], ["nothing", Buffer.alloc(0)]] as const) assert.throws(() => S.checkWav(sound), /could not be read/, what);
  assert.throws(() => S.checkWav(wav(0.05)), /too short/);
  assert.throws(() => S.checkWav(Buffer.concat([wav(1), Buffer.alloc(S.MAX_WAV)])), /longer than twenty minutes/);
  // A header that claims more sound than was sent is measured by what is there.
  const lying = wav(2);
  lying.writeUInt32LE(0x7fffffff, 40);
  assert.deepEqual(S.checkWav(lying), { seconds: 2 });
});

test("without the speech program this copy of Talqava says so; with it, the model is one download away", async () => {
  assert.equal(S.speechStatus().state, "unavailable");
  await assert.rejects(S.transcribe(wav(1)), /built without the speech program/);
  process.env.TALQAVA_WHISPER_SERVER = program;
  const status = S.speechStatus();
  assert.deepEqual([status.state, status.model, status.models.map((m) => [m.id, m.here])], ["needs-model", "base", [["tiny", false], ["base", false], ["small", false]]]);
  await assert.rejects(S.transcribe(wav(1)), /not downloaded yet/);
  assert.throws(() => S.fetchModel("huge"), /from the list/);
});

test("a downloaded model that is not the file whisper.cpp lists is thrown away", async () => {
  S.fetchModel("tiny");
  assert.throws(() => S.fetchModel("base"), /already being downloaded/);
  for (let i = 0; i < 100 && !S.speechStatus().download?.problem; i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(S.speechStatus().download!.problem!, /checksum differs/);
  assert.deepEqual(fs.readdirSync(path.join(data, "speech")).filter((f) => f.startsWith("ggml-")), [], "nothing is kept, not even a part");
  assert.equal(S.speechStatus().state, "needs-model");
});

test("the program is started when first needed, on this computer only, and the words come back tidied", async () => {
  // A model that is already here is chosen without downloading.
  fs.writeFileSync(path.join(data, "speech", "ggml-small.bin"), "model");
  S.fetchModel("small");
  assert.deepEqual([S.speechStatus().state, S.speechStatus().model, S.speechStatus().running], ["ready", "small", false]);
  const heard = await S.transcribe(wav(2));
  assert.deepEqual(heard, { text: "Order two loaves\nfor Friday.", seconds: 2 }, "marks for silence and music are not words");
  assert.equal(S.speechStatus().running, true);
  // Two at once are done one after the other by the same program.
  const both = await Promise.all([S.transcribe(wav(1)), S.transcribe(wav(1))]);
  assert.deepEqual(both.map((x) => x.seconds), [1, 1]);
  await S.stop();
  assert.equal(S.speechStatus().running, false);
  // Removing the model in use stops the program and asks for a download again.
  await S.removeModel("small");
  assert.equal(S.speechStatus().state, "needs-model");
});

test("a program that cannot start says why, and is not left running", async () => {
  fs.writeFileSync(path.join(data, "speech", "ggml-base.bin"), "model");
  const broken = path.join(data, "broken-server");
  fs.writeFileSync(broken, `#!${process.execPath}\nconsole.error("failed to initialize whisper context"); process.exit(3);\n`);
  fs.chmodSync(broken, 0o755);
  process.env.TALQAVA_WHISPER_SERVER = broken;
  await assert.rejects(S.transcribe(wav(1)), /stopped while starting \(code 3\)\. failed to initialize whisper context/);
  assert.equal(S.speechStatus().running, false);
  process.env.TALQAVA_WHISPER_SERVER = program;
  assert.equal((await S.transcribe(wav(1))).text, "Order two loaves\nfor Friday.");
});
