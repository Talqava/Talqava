// Run first when Talqava starts: if a restore is waiting, it is put in place now, before the data is read.
import { applyPendingRestore } from "./restore-pending.ts";

const done = applyPendingRestore();
if (done) console.log(`Restored ${done.from}. What was there before is kept in ${done.kept}.`);
