import { LIGHTHOUSE_PRESETS } from '../src/physics.ts';
import { runSelfCheck } from '../src/selfcheck.ts';

let failures = 0;
let runs = 0;

function check(cfg, label) {
  const results = runSelfCheck(cfg);
  runs++;
  for (const r of results) {
    if (!r.pass) {
      failures++;
      console.error(`FAIL [${label}] ${r.id}: expected ${r.expected}, got ${r.measured}, error ${r.errorPct.toFixed(3)}%`);
    }
  }
}

for (const p of LIGHTHOUSE_PRESETS) check(p, p.id);

// 扫过 UI 允许的参数范围，确保 5% 约束不是只对默认值成立。
for (const panelCount of [2, 3, 4, 6, 8, 12, 16]) {
  for (const focalLengthM of [0.35, 0.55, 0.9, 1.35, 2.0]) {
    for (const sourceDiameterM of [0.02, 0.05, 0.12]) {
      for (const rpm of [0.2, 1, 2, 6]) {
        check({
          ...LIGHTHOUSE_PRESETS[0],
          panelCount,
          focalLengthM,
          sourceDiameterM,
          rpm
        }, `sweep N${panelCount} f${focalLengthM} d${sourceDiameterM} rpm${rpm}`);
      }
    }
  }
}

if (failures) {
  console.error(`\n${failures} physics consistency failures across ${runs} configurations.`);
  process.exit(1);
}
console.log(`Physics verification passed: all checks ≤5% across ${runs} configurations.`);
