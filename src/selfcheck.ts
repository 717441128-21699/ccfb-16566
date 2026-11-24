import {
  ALLARD_THRESHOLD_LUX,
  allardIlluminance,
  allardIlluminanceNm,
  allardRangeM,
  beamResponse,
  getFlashTiming,
  NAUTICAL_MILE_M,
  observedFlash,
  type LensConfig,
  type AtmosphereConfig
} from './physics.ts';

export type ExhibitStateLike = LensConfig & AtmosphereConfig;

export interface CheckResult {
  id: string;
  label: string;
  expected: string;
  measured: string;
  errorPct: number;
  pass: boolean;
}

function errorPct(expected: number, measured: number): number {
  return Math.abs(measured - expected) / Math.max(Math.abs(expected), 1e-12) * 100;
}

/** 对和 WGSL 同源的时间/角度包络加密采样，量出画面中的周期和半高宽。 */
export function runSelfCheck(cfg: ExhibitStateLike): CheckResult[] {
  const timing = getFlashTiming(cfg);
  const results: CheckResult[] = [];

  // 1) 角度半高宽：在 -2θ..2θ 内量 >=0.5 的连续区间。
  const angleSamples = 20000;
  const angleSpan = timing.divergenceRad * 4;
  let a0 = NaN;
  let a1 = NaN;
  for (let i = 0; i <= angleSamples; i++) {
    const a = -angleSpan / 2 + angleSpan * i / angleSamples;
    if (beamResponse(a, timing.halfAngleRad) >= 0.5) {
      if (Number.isNaN(a0)) a0 = a;
      a1 = a;
    }
  }
  const visualDivergence = a1 - a0;
  const angleErr = errorPct(timing.divergenceRad, visualDivergence);
  results.push({
    id: 'divergence',
    label: '焦距 → 光束发散角',
    expected: `${timing.divergenceDeg.toFixed(3)}°`,
    measured: `${(visualDivergence * 180 / Math.PI).toFixed(3)}°`,
    errorPct: angleErr,
    pass: angleErr <= 5
  });

  // 2) 时间域采样：找每个 >=0.5 闪光区间的中点，量周期和持续时间。
  // 从 -flashPeriod 开始，避免 t=0 截断第一个脉冲而污染计数。
  const tStart = -timing.flashPeriodS;
  const totalT = timing.rotationPeriodS * 2.2;
  const dt = Math.min(timing.flashDurationS / 80, timing.flashPeriodS / 300);
  type Interval = { start: number; end: number };
  const intervals: Interval[] = [];
  let inside = false;
  let start = 0;
  const firstValue = observedFlash(tStart, 0, cfg) >= 0.5;
  if (firstValue) {
    inside = true;
    start = tStart;
  }
  for (let t = tStart + dt; t <= totalT; t += dt) {
    const on = observedFlash(t, 0, cfg) >= 0.5;
    if (on && !inside) {
      inside = true;
      // 线性插值跨越 0.5 的时刻。
      const y0 = observedFlash(t - dt, 0, cfg);
      const y1 = observedFlash(t, 0, cfg);
      start = t - dt + (0.5 - y0) * dt / (y1 - y0 || 1);
    } else if (!on && inside) {
      inside = false;
      const y0 = observedFlash(t - dt, 0, cfg);
      const y1 = observedFlash(t, 0, cfg);
      const end = t - dt + (0.5 - y0) * dt / (y1 - y0 || 1);
      intervals.push({ start, end });
    }
  }
  if (inside) intervals.push({ start, end: totalT });

  const complete = intervals.filter((x) => x.start > tStart + dt * 2 && x.end < totalT - dt * 2);
  const durations = complete.map((x) => x.end - x.start);
  const visualDuration = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
  const durationErr = errorPct(timing.flashDurationS, visualDuration);
  results.push({
    id: 'duration',
    label: '转速/发散角 → 闪光时长',
    expected: `${(timing.flashDurationS * 1000).toFixed(1)} ms`,
    measured: `${(visualDuration * 1000).toFixed(1)} ms`,
    errorPct: durationErr,
    pass: durationErr <= 5
  });

  const centers = complete.map((x) => (x.start + x.end) / 2).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
  const visualPeriod = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const periodErr = errorPct(timing.flashPeriodS, visualPeriod);
  results.push({
    id: 'period',
    label: '面板数/转速 → 闪光周期',
    expected: `${timing.flashPeriodS.toFixed(3)} s`,
    measured: `${visualPeriod.toFixed(3)} s`,
    errorPct: periodErr,
    pass: periodErr <= 5
  });

  // 用采样周期反推每转闪光数；避免 [0,Trot) 边界上的峰中心因浮点误差重复/丢失。
  const peaksThisRotation = Math.round(timing.rotationPeriodS / visualPeriod);
  const panelErr = errorPct(cfg.panelCount, peaksThisRotation);
  results.push({
    id: 'panels',
    label: '一圈内光束/闪光数',
    expected: `${cfg.panelCount}`,
    measured: `${peaksThisRotation}`,
    errorPct: panelErr,
    pass: panelErr <= 5
  });

  // 3) Allard 反解射程后，代回 SI 定律应正好落在阈值。
  const rangeM = allardRangeM(cfg);
  const atRange = allardIlluminance(rangeM, cfg);
  const rangeErr = errorPct(ALLARD_THRESHOLD_LUX, atRange);
  results.push({
    id: 'allard',
    label: '能见度/光强 → Allard 射程',
    expected: `Eₜ=${ALLARD_THRESHOLD_LUX.toExponential(1)} lx`,
    measured: `E(R)=${atRange.toExponential(3)} lx, R=${(rangeM / 1000).toFixed(2)} km`,
    errorPct: rangeErr,
    pass: rangeErr <= 5
  });

  // 4) SI 与海里 T^R 写法一致性。
  const rNm = rangeM / NAUTICAL_MILE_M;
  const eSi = allardIlluminance(rNm * NAUTICAL_MILE_M, cfg);
  const eNm = allardIlluminanceNm(rNm, cfg);
  const unitErr = errorPct(eSi, eNm);
  results.push({
    id: 'units',
    label: 'Allard SI/海里公式一致',
    expected: eSi.toExponential(4),
    measured: eNm.toExponential(4),
    errorPct: unitErr,
    pass: unitErr <= 1
  });

  return results;
}
