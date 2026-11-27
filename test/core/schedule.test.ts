import { test } from "node:test";
import assert from "node:assert/strict";
import { JobBook, describeSchedule, nextRun, parseSchedule } from "../../src/core/index.ts";
import { MemoryJobs } from "../memory-stores.ts";

const at = (text: string) => new Date(text);
const local = (date: Date | null) =>
  date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}` : "never";

test("intervals", () => {
  assert.equal(nextRun("every 30m", at("2026-01-01T10:00:00"))!.getTime(), at("2026-01-01T10:30:00").getTime());
  assert.equal(nextRun("every 2 hours", at("2026-01-01T10:00:00"))!.getTime(), at("2026-01-01T12:00:00").getTime());
});

test("cron lines", () => {
  assert.equal(local(nextRun("0 9 * * *", at("2026-01-01T10:00:00"))), "2026-1-2 9:00");
  assert.equal(local(nextRun("*/15 * * * *", at("2026-01-01T10:07:00"))), "2026-1-1 10:15");
  // 2026-01-02 is a Friday; the next weekday 8:30 after Friday 9:00 is Monday.
  assert.equal(local(nextRun("30 8 * * 1-5", at("2026-01-02T09:00:00"))), "2026-1-5 8:30");
  assert.equal(local(nextRun("0 0 1 3 *", at("2026-01-02T09:00:00"))), "2026-3-1 0:00");
  assert.equal(local(nextRun("0 12 * * 0", at("2026-01-02T09:00:00"))), "2026-1-4 12:00");
});

test("one-time and invalid schedules", () => {
  assert.equal(nextRun("at 2030-05-01T09:00", at("2026-01-01T00:00:00"))!.getFullYear(), 2030);
  assert.equal(nextRun("at 2020-05-01T09:00", at("2026-01-01T00:00:00")), null);
  assert.throws(() => parseSchedule("whenever"), /could not be read/);
  assert.throws(() => parseSchedule("61 * * * *"), /Bad cron/);
  assert.throws(() => parseSchedule("every 10s"), /could not be read/);
});

test("due jobs fire once and move to their next time", async () => {
  const store = new MemoryJobs();
  const jobs = new JobBook(store);
  const job = await jobs.create({ name: "digest", prompt: "do it", schedule: "every 1h" });
  assert.deepEqual(await jobs.takeDue(new Date()), []);
  const later = new Date(Date.now() + 2 * 3_600_000);
  assert.equal((await jobs.takeDue(later))[0].id, job.id);
  assert.deepEqual(await jobs.takeDue(later), []);
  assert.ok(new Date(store.items[0].nextRunAt!) > later);
});

test("jobs can be paused, resumed and removed", async () => {
  const jobs = new JobBook(new MemoryJobs());
  const job = await jobs.create({ name: "digest", prompt: "do it", schedule: "0 9 * * *" });
  assert.equal((await jobs.update(job.id, { enabled: false })).enabled, false);
  assert.equal((await jobs.update(job.id, { enabled: true })).enabled, true);
  await jobs.remove(job.id);
  assert.deepEqual(await jobs.list(), []);
  await assert.rejects(jobs.remove(job.id), /no longer exists/);
  await assert.rejects(jobs.create({ name: "", prompt: "x", schedule: "every 1h" }), /Give the schedule a name/);
});

test("schedules in plain words, and changing one", async () => {
  assert.equal(describeSchedule("0 9 * * *"), "Every day at 9:00 am");
  assert.equal(describeSchedule("30 17 * * 1-5"), "Every weekday at 5:30 pm");
  assert.equal(describeSchedule("0 12 * * 1"), "Every Monday at 12:00 pm");
  assert.equal(describeSchedule("0 0 * * 7"), "Every Sunday at 12:00 am");
  assert.equal(describeSchedule("15 8 1 * *"), "Every month on the 1st at 8:15 am");
  assert.equal(describeSchedule("0 8 22 * *"), "Every month on the 22nd at 8:00 am");
  assert.equal(describeSchedule("every 2h"), "Every 2 hours");
  assert.equal(describeSchedule("every 1d"), "Every day");
  assert.match(describeSchedule("at 2030-05-01T09:00"), /^Once, on Wednesday, May 1, 2030 at 9:00 am$/);
  // Anything unusual is shown as written.
  assert.equal(describeSchedule("*/15 9-17 * * 1-5"), "*/15 9-17 * * 1-5");

  const jobs = new JobBook(new MemoryJobs());
  await assert.rejects(jobs.create({ name: "", prompt: "x", schedule: "every 1h" }), /Give the schedule a name/);
  await assert.rejects(jobs.create({ name: "x", prompt: " ", schedule: "every 1h" }), /Write the instructions/);
  const job = await jobs.create({ name: "Digest", prompt: "Summarise the news.", schedule: "every 1h", owner: "researcher", org: "org1" });
  assert.deepEqual([job.owner, job.org], ["researcher", "org1"]);
  await jobs.update(job.id, { enabled: false });
  const changed = await jobs.edit(job.id, { name: "Morning digest", schedule: "0 8 * * 1-5", owner: null });
  assert.deepEqual([changed.name, changed.schedule, changed.enabled, changed.owner, changed.org], ["Morning digest", "0 8 * * 1-5", true, null, null]);
  assert.equal(new Date(changed.nextRunAt!).getHours(), 8);
  await assert.rejects(jobs.edit(job.id, { schedule: "at 2020-01-01T09:00" }), /already in the past/);
  await assert.rejects(jobs.edit(job.id, { prompt: "" }), /Write the instructions/);
  await assert.rejects(jobs.edit("nope", { name: "x" }), /no longer exists/);
});

test("how often a schedule runs in a month, for saying what it costs", async () => {
  const { runsIn } = await import("../../src/core/index.ts");
  const from = at("2026-03-02T00:00:00"); // a Monday
  assert.equal(runsIn("every 1h", 30, from), 720);
  assert.equal(runsIn("0 8 * * *", 30, from), 30);
  assert.equal(runsIn("0 8 * * 1-5", 28, from), 20);
  assert.equal(runsIn("0 8 * * 1", 28, from), 4);
  assert.equal(runsIn("0 8 1 * *", 31, from), 1);
  assert.equal(runsIn("at 2020-01-01T10:00:00", 30, from), 0, "a time that has passed never runs");
  assert.equal(runsIn("nonsense", 30, from), 0);
});
