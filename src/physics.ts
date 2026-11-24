// 全部展项共享的光学、闪光与阿拉德定律计算。
// WebGPU 着色器中的包络/消光公式必须与本文件保持同一数学定义。

export const KOSCHMIEDER_CONSTANT = 2.996;
/** 夜间人眼对固定灯光的教学用照度阈值，0.2 微勒克斯。 */
export const ALLARD_THRESHOLD_LUX = 2e-7;
export const NAUTICAL_MILE_M = 1852;

export interface LensConfig {
  /** 面板数：一圈中有多少块独立光学面板/光束。 */
  panelCount: number;
  /** 菲涅尔透镜焦距 f，单位 m。 */
  focalLengthM: number;
  /** 光源发光体有效直径 d，单位 m。 */
  sourceDiameterM: number;
  /** 透镜/灯组转速，r/min。 */
  rpm: number;
}

export interface AtmosphereConfig {
  /** 气象能见度 MOR，km。 */
  visibilityKm: number;
  /** 灯光轴向发光强度，cd。 */
  intensityCd: number;
  /** 反照率：雾滴散射占总消光比例。 */
  scatteringAlbedo?: number;
  thresholdLux?: number;
}

export interface FlashTiming {
  rotationPeriodS: number;
  flashPeriodS: number;
  angularSpeedRadS: number;
  angularSpeedDegS: number;
  divergenceRad: number;
  divergenceDeg: number;
  halfAngleRad: number;
  flashDurationS: number;
  dutyCycle: number;
  flashesPerMinute: number;
  panelPitchDeg: number;
  panelsOverlap: boolean;
}

export interface LighthousePreset extends LensConfig, AtmosphereConfig {
  id: string;
  name: string;
  waterArea: string;
  order: string;
  characteristic: string;
  lanternHeightM: number;
  lightColor: [number, number, number];
  invented: true;
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapPi(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 有限尺寸光源位于焦点附近时的几何发散全角：
 * θ = 2 atan(d / 2f)。
 */
export function beamDivergence(focalLengthM: number, sourceDiameterM: number): number {
  return 2 * Math.atan(sourceDiameterM / (2 * focalLengthM));
}

export function getFlashTiming(cfg: LensConfig): FlashTiming {
  const rotationPeriodS = 60 / cfg.rpm;
  const flashPeriodS = rotationPeriodS / cfg.panelCount;
  const angularSpeedRadS = (2 * Math.PI * cfg.rpm) / 60;
  const angularSpeedDegS = 360 * cfg.rpm / 60;
  const divergenceRad = beamDivergence(cfg.focalLengthM, cfg.sourceDiameterM);
  const halfAngleRad = divergenceRad / 2;
  const flashDurationS = divergenceRad / angularSpeedRadS;
  const panelPitch = (2 * Math.PI) / cfg.panelCount;
  return {
    rotationPeriodS,
    flashPeriodS,
    angularSpeedRadS,
    angularSpeedDegS,
    divergenceRad,
    divergenceDeg: divergenceRad * 180 / Math.PI,
    halfAngleRad,
    flashDurationS,
    dutyCycle: flashDurationS / flashPeriodS,
    flashesPerMinute: cfg.rpm * cfg.panelCount,
    panelPitchDeg: 360 / cfg.panelCount,
    panelsOverlap: divergenceRad > panelPitch
  };
}

/**
 * 与 WGSL beamResponse 相同的半高宽包络。
 * 在 |δ| = halfAngle 处响应恰为 0.5，因此 FWHM 正好等于几何发散角。
 */
export function beamResponse(angleDeltaRad: number, halfAngleRad: number): number {
  const a = Math.abs(wrapPi(angleDeltaRad));
  const feather = Math.max(halfAngleRad * 0.18, 0.00015);
  return 1 - smoothstep(halfAngleRad - feather, halfAngleRad + feather, a);
}

/** t 时刻固定方位观察者看到的闪光包络，0..1。 */
export function observedFlash(tS: number, observerBearingRad: number, cfg: LensConfig): number {
  const timing = getFlashTiming(cfg);
  const rotation = timing.angularSpeedRadS * tS;
  let response = 0;
  for (let i = 0; i < cfg.panelCount; i++) {
    const axis = rotation + i * 2 * Math.PI / cfg.panelCount;
    response = Math.max(response, beamResponse(observerBearingRad - axis, timing.halfAngleRad));
  }
  return response;
}

/** MOR 能见度 -> 消光系数 m^-1（Koschmieder 对比度阈值 0.05）。 */
export function extinctionPerM(visibilityKm: number): number {
  return KOSCHMIEDER_CONSTANT / Math.max(0.02, visibilityKm) / 1000;
}

/** Allard 公式中的每海里大气透射率 T。 */
export function allardTransmissivityPerNm(visibilityKm: number): number {
  const sigmaNm = extinctionPerM(visibilityKm) * NAUTICAL_MILE_M;
  return Math.exp(-sigmaNm);
}

/**
 * 阿拉德定律 SI 形式：
 * E(D) = I / D² · exp(-σD)
 * D 以 m 计，I 以 cd 计，结果为 lx。
 */
export function allardIlluminance(distanceM: number, atm: AtmosphereConfig): number {
  const sigma = extinctionPerM(atm.visibilityKm);
  return atm.intensityCd / Math.max(1, distanceM * distanceM) * Math.exp(-sigma * distanceM);
}

/** 阿拉德定律的海里/透射率写法：E = I·T^R / (1852²R²)。 */
export function allardIlluminanceNm(distanceNm: number, atm: AtmosphereConfig): number {
  const t = allardTransmissivityPerNm(atm.visibilityKm);
  const threshold = atm.thresholdLux ?? ALLARD_THRESHOLD_LUX;
  void threshold;
  return atm.intensityCd * Math.pow(t, distanceNm) /
    (NAUTICAL_MILE_M * NAUTICAL_MILE_M * distanceNm * distanceNm);
}

/** 数值反解 Allard 灯光射程，单位 m。 */
export function allardRangeM(atm: AtmosphereConfig): number {
  const threshold = atm.thresholdLux ?? ALLARD_THRESHOLD_LUX;
  let lo = 1;
  let hi = 10_000;
  // E 随距离严格单调下降；先指数扩展上界。
  while (allardIlluminance(hi, atm) > threshold && hi < 2_000_000) hi *= 2;
  for (let i = 0; i < 70; i++) {
    const mid = Math.sqrt(lo * hi);
    if (allardIlluminance(mid, atm) > threshold) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function allardRangeNm(atm: AtmosphereConfig): number {
  return allardRangeM(atm) / NAUTICAL_MILE_M;
}

/** 含地球曲率与标准大气折射的地理视距，返回 km。 */
export function geographicRangeKm(lanternHeightM: number, eyeHeightM: number): number {
  return 4.12 * (Math.sqrt(Math.max(0, lanternHeightM)) + Math.sqrt(Math.max(0, eyeHeightM)));
}

export interface RangeReport {
  allardRangeKm: number;
  allardRangeNm: number;
  geographicRangeKm: number;
  geographicRangeNm: number;
  effectiveRangeKm: number;
  effectiveRangeNm: number;
  transmissivityPerNm: number;
  extinctionPerKm: number;
}

export function getRangeReport(
  atm: AtmosphereConfig,
  lanternHeightM: number,
  eyeHeightM: number
): RangeReport {
  const allardM = allardRangeM(atm);
  const geoKm = geographicRangeKm(lanternHeightM, eyeHeightM);
  const effectiveKm = Math.min(allardM / 1000, geoKm);
  return {
    allardRangeKm: allardM / 1000,
    allardRangeNm: allardM / NAUTICAL_MILE_M,
    geographicRangeKm: geoKm,
    geographicRangeNm: geoKm * 1000 / NAUTICAL_MILE_M,
    effectiveRangeKm: effectiveKm,
    effectiveRangeNm: effectiveKm * 1000 / NAUTICAL_MILE_M,
    transmissivityPerNm: allardTransmissivityPerNm(atm.visibilityKm),
    extinctionPerKm: extinctionPerM(atm.visibilityKm) * 1000
  };
}

/** 雾中体积光的可见长度：Allard 射程与数倍能见度共同约束。 */
export function volumeBeamReachM(atm: AtmosphereConfig): number {
  const visM = atm.visibilityKm * 1000;
  return Math.min(allardRangeM(atm), 3.2 * visM);
}

/** 多次散射造成的视觉光晕增宽；核心光束边界仍使用 divergence。 */
export function fogHaloHalfAngleRad(visibilityKm: number): number {
  const sigmaKm = KOSCHMIEDER_CONSTANT / Math.max(0.02, visibilityKm);
  return 0.012 * Math.log1p(sigmaKm * 2.5);
}

export const LIGHTHOUSE_PRESETS: LighthousePreset[] = [
  {
    id: 'qixingjiao',
    name: '七星礁灯塔',
    waterArea: '东海 · 虚构教学海域',
    order: '一等福尔涅尔透镜',
    panelCount: 12,
    focalLengthM: 1.35,
    sourceDiameterM: 0.045,
    rpm: 1.0,
    intensityCd: 2_400_000,
    visibilityKm: 6,
    lanternHeightM: 46,
    characteristic: 'Fl W 5s — 每 5.00 s 一道短闪光',
    lightColor: [1.0, 0.84, 0.52],
    invented: true
  },
  {
    id: 'lanyu',
    name: '岚屿灯塔',
    waterArea: '南海 · 虚构教学海域',
    order: '大型八面板透镜',
    panelCount: 8,
    focalLengthM: 0.92,
    sourceDiameterM: 0.05,
    rpm: 1.25,
    intensityCd: 1_100_000,
    visibilityKm: 12,
    lanternHeightM: 38,
    characteristic: 'Fl W 6s — 宽光束、节奏沉稳',
    lightColor: [0.86, 0.94, 1.0],
    invented: true
  },
  {
    id: 'baijimen',
    name: '白矶门灯塔',
    waterArea: '渤海湾 · 虚构教学海域',
    order: '六面板港口透镜',
    panelCount: 6,
    focalLengthM: 0.7,
    sourceDiameterM: 0.055,
    rpm: 2.0,
    intensityCd: 420_000,
    visibilityKm: 6,
    lanternHeightM: 31,
    characteristic: 'Fl W 5s — 近岸高频扫光',
    lightColor: [1.0, 0.91, 0.72],
    invented: true
  },
  {
    id: 'nandingjiao',
    name: '南碇角灯塔',
    waterArea: '台湾海峡 · 虚构教学海域',
    order: '四面板宽角透镜',
    panelCount: 4,
    focalLengthM: 0.55,
    sourceDiameterM: 0.06,
    rpm: 2.0,
    intensityCd: 260_000,
    visibilityKm: 3,
    lanternHeightM: 27,
    characteristic: 'Fl W 7.5s — 宽发散、雾中更易发现',
    lightColor: [1.0, 0.78, 0.48],
    invented: true
  }
];
