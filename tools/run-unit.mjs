// run-unit.mjs — runs the Node unit tests once per timezone, because the
// day-boundary logic must be right wherever (and whenever) the phone is.
//   Chicago      the real one (DST, 1-hour shifts)
//   UTC          no DST at all
//   Lord_Howe    30-minute DST shift
//   Kolkata      +5:30 offset, no DST
//   Auckland     southern hemisphere: DST in the "wrong" months
import { spawnSync } from 'node:child_process';

const ZONES = ['America/Chicago', 'UTC', 'Australia/Lord_Howe', 'Asia/Kolkata', 'Pacific/Auckland'];
let failed = 0;
for (const TZ of ZONES) {
  console.log(`\n=== TZ=${TZ} ===`);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', 'tests/unit/*.test.mjs'], {
    stdio: 'inherit', env: { ...process.env, TZ },
  });
  if (r.status !== 0) { failed++; console.log(`FAILED in ${TZ}`); }
}
console.log(failed ? `\n${failed} timezone run(s) failed` : `\nAll unit tests passed in ${ZONES.length} timezones`);
process.exit(failed ? 1 : 0);
