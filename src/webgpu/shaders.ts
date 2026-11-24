// 原生 WebGPU/WGSL 展项着色器。
// 外景/船视角：解析圆锥 + Cornette–Shanks(米氏近似) 单次散射积分。
// 剖面/光路：按 f、N、全反射向量实时生成结构与光路。

export const exhibitShaderWGSL = /* wgsl */ `
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

struct U {
  resTime: vec4f,   // width, height, wallTime, simTime
  lens: vec4f,      // panelCount, focalM, sourceDiameterM, rpm
  beam: vec4f,      // halfAngle, divergence, omegaRadS, rotationRad
  fog: vec4f,       // sigmaPerM, reachM, intensity01, haloHalfAngle
  obs: vec4f,       // distanceM, bearingRad, eyeHeightM, tanHalfFov
  lightColor: vec4f,// r,g,b, lanternHeightM
  flags: vec4f,     // mode, showVolume, showCore, showRays
  extras: vec4f     // showTir, adaptiveScale, benchmark, unused
}
@group(0) @binding(0) var<uniform> u: U;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f
}

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VSOut {
  var verts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let clip = verts[vid];
  var out: VSOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.uv = clip * 0.5 + 0.5;
  return out;
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  let m = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, m.x), mix(c, d, m.x), m.y);
}

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sdBox(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn addSegment(col: vec3f, p: vec2f, a: vec2f, b: vec2f, width: f32, c: vec3f, strength: f32) -> vec3f {
  let d = sdSegment(p, a, b);
  let core = 1.0 - smoothstep(width * 0.55, width * 1.25, d);
  let glow = exp(-d * d / max(width * width * 150.0, 1e-6));
  return col + c * strength * (core + glow * 0.12);
}

fn addPhoton(col: vec3f, p: vec2f, a: vec2f, b: vec2f, phase: f32, speed: f32, t: f32, c: vec3f) -> vec3f {
  let len = length(b - a);
  let dir = (b - a) / max(len, 1e-6);
  let q = p - a;
  let along = dot(q, dir);
  let perp = length(q - dir * along);
  let head = fract(t * speed + phase) * len;
  let d2 = (along - head) * (along - head) + perp * perp;
  return col + c * 1.15 * exp(-d2 / 0.00045);
}

struct Cam {
  pos: vec3f,
  fwd: vec3f,
  right: vec3f,
  up: vec3f,
  tanH: f32,
  aspect: f32,
};

fn lookCamera(pos: vec3f, aim: vec3f, tanH: f32, aspect: f32) -> Cam {
  var c: Cam;
  c.pos = pos;
  c.fwd = normalize(aim - pos);
  c.right = normalize(cross(c.fwd, vec3f(0.0, 1.0, 0.0)));
  c.up = normalize(cross(c.right, c.fwd));
  c.tanH = tanH;
  c.aspect = aspect;
  return c;
}

fn rayDir(c: Cam, uv: vec2f) -> vec3f {
  let x = (uv.x - 0.5) * 2.0 * c.tanH * c.aspect;
  let y = (uv.y - 0.5) * 2.0 * c.tanH;
  return normalize(c.fwd + x * c.right + y * c.up);
}

fn project(c: Cam, p: vec3f) -> vec2f {
  let q = p - c.pos;
  let z = dot(q, c.fwd);
  let x = dot(q, c.right);
  let y = dot(q, c.up);
  return vec2f(
    0.5 + x / (2.0 * z * c.tanH * c.aspect),
    0.5 + y / (2.0 * z * c.tanH)
  );
}

fn miePhase(mu: f32, g: f32) -> f32 {
  // Cornette–Shanks 米氏近似，适合雾滴强前向散射。
  let gg = g * g;
  let den = pow(max(1.0 + gg - 2.0 * g * mu, 0.001), 1.5);
  return 3.0 * (1.0 - gg) / (8.0 * PI * (2.0 + gg)) * (1.0 + mu * mu) / den;
}

fn skyColor(rd: vec3f, t: f32) -> vec3f {
  let h = clamp(rd.y * 1.35 + 0.18, 0.0, 1.0);
  var col = mix(vec3f(0.105, 0.145, 0.225), vec3f(0.012, 0.025, 0.065), pow(h, 0.72));
  let starZone = smoothstep(0.02, 0.22, rd.y);
  let sp = floor((rd.xz / max(0.12, abs(rd.y) + 0.25)) * 210.0);
  let star = step(0.9975, hash21(sp)) * starZone * (0.55 + 0.45 * sin(t * 1.7 + hash21(sp + 7.0) * 20.0));
  col += vec3f(0.75, 0.86, 1.0) * star;
  let moonDir = normalize(vec3f(-0.42, 0.48, -0.77));
  let md = max(dot(rd, moonDir), 0.0);
  col += vec3f(0.55, 0.68, 0.95) * (pow(md, 260.0) * 1.4 + pow(md, 18.0) * 0.08);
  return col;
}

fn seaSurface(ro: vec3f, rd: vec3f, tSea: f32, sigma: f32, t: f32) -> vec3f {
  let p = ro + rd * tSea;
  let farFade = exp(-tSea * 0.0045);
  let wave = noise2(p.xz * 0.055 + vec2f(t * 0.035, -t * 0.025));
  let n = normalize(vec3f((wave - 0.5) * 0.035 * farFade, 1.0, (noise2(p.zx * 0.05) - 0.5) * 0.03 * farFade));
  let fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
  let skyRef = skyColor(reflect(rd, n), t);
  var sea = mix(vec3f(0.012, 0.045, 0.075), vec3f(0.08, 0.13, 0.19), fres * 0.75);
  sea += skyRef * fres * 0.35;
  let pathWidth = max(3.0, 4.0 + p.z * 0.035);
  let moonPath = pow(max(0.0, 1.0 - abs(p.x) / pathWidth), 3.0) *
                 max(0.0, sin(p.z * 0.18 + t * 1.1)) * farFade;
  sea += vec3f(0.35, 0.48, 0.62) * moonPath * 0.10;
  let fogMix = 1.0 - exp(-sigma * tSea);
  return mix(sea, vec3f(0.39, 0.46, 0.56), clamp(fogMix * 0.82, 0.0, 0.92));
}

fn expIntegral(a0: f32, at: f32, sigma: f32, t0: f32, t1: f32) -> f32 {
  if (t1 <= t0) { return 0.0; }
  let c = sigma * (1.0 + at);
  let pre = exp(-sigma * a0);
  if (abs(c) < 1e-7) { return pre * (t1 - t0); }
  return pre * (exp(-c * t0) - exp(-c * t1)) / c;
}

fn coneScatter(
  ro: vec3f,
  rd: vec3f,
  lamp: vec3f,
  axis: vec3f,
  halfAngle: f32,
  r0: f32,
  densityGain: f32,
  phase: f32,
  tLimit: f32
) -> vec3f {
  let q0 = ro - lamp;
  let a0 = dot(q0, axis);
  let at = dot(rd, axis);
  let qd = dot(q0, rd);
  let q20 = dot(q0, q0);
  let k = tan(halfAngle);

  // F(t)=|q_perp|²-(k a+r0)² = A t²+B t+C。
  let A = 1.0 - (1.0 + k * k) * at * at;
  let B = 2.0 * qd - 2.0 * (1.0 + k * k) * a0 * at - 2.0 * k * r0 * at;
  let C = q20 - (1.0 + k * k) * a0 * a0 - 2.0 * k * r0 * a0 - r0 * r0;

  // 先裁到 0<=t<=tLimit 且 0<=a<=reach。
  var lo = 0.0;
  var hi = min(tLimit, 160000.0);
  if (abs(at) > 1e-7) {
    let tA0 = -a0 / at;
    let tAR = (u.fog.y - a0) / at;
    lo = max(lo, min(tA0, tAR));
    hi = min(hi, max(tA0, tAR));
  }
  if (hi <= lo) { return vec3f(0.0); }

  var integral = 0.0;
  let sigma = u.fog.x;
  let disc = B * B - 4.0 * A * C;

  if (abs(A) < 1e-8) {
    if (abs(B) < 1e-8) {
      if (C <= 0.0) { integral = expIntegral(a0, at, sigma, lo, hi); }
    } else {
      let root = -C / B;
      if (B > 0.0) { hi = min(hi, root); }
      else { lo = max(lo, root); }
      integral = expIntegral(a0, at, sigma, lo, hi);
    }
  } else if (disc < 0.0) {
    if (C <= 0.0) { integral = expIntegral(a0, at, sigma, lo, hi); }
  } else {
    let s = sqrt(max(disc, 0.0));
    let ra = (-B - s) / (2.0 * A);
    let rb = (-B + s) / (2.0 * A);
    let rootLo = min(ra, rb);
    let rootHi = max(ra, rb);
    if (A > 0.0) {
      // 开口向上：F<=0 位于两根之间。
      integral = expIntegral(a0, at, sigma, max(lo, rootLo), min(hi, rootHi));
    } else {
      // 开口向下：F<=0 位于两根之外；最多保留前后两段。
      integral += expIntegral(a0, at, sigma, lo, min(hi, rootLo));
      integral += expIntegral(a0, at, sigma, max(lo, rootHi), hi);
    }
  }

  let betaSca = sigma * 0.92;
  let optical = betaSca * integral;
  // 归一化 Mie 相位在侧向非常小；展项视觉增益补回显示曝光，并保留前向强散射。
  let displayPhase = 0.55 + phase * 2.6;
  let gain = 21.0 * densityGain * u.fog.z;
  let emitted = u.lightColor.rgb * displayPhase * max(optical, 0.0) * gain;
  // 直视光束时解析积分会产生极高 HDR 值；单光束软压缩，避免整屏死白。
  return emitted / (1.0 + emitted * 3.2);
}

fn drawTower(inputCol: vec3f, uv: vec2f, cam: Cam, lamp: vec3f, t: f32, shipView: bool) -> vec3f {
  var col = inputCol;
  let baseY = select(0.0, 6.0, !shipView);
  let viewDist = length(cam.pos - lamp);
  let transmission = exp(-u.fog.x * viewDist);
  let direct = select(1.0, transmission, shipView);
  let fogCol = vec3f(0.39, 0.46, 0.56);
  let base = vec3f(0.0, baseY, 0.0);
  let pb = project(cam, base);
  let pl = project(cam, lamp);
  if (pl.x < -0.2 || pl.x > 1.2 || pl.y < -0.2 || pl.y > 1.2) { return col; }

  let wb = abs(project(cam, base + cam.right * 4.4).x - pb.x);
  let wt = abs(project(cam, vec3f(0.0, lamp.y - 3.2, 0.0) + cam.right * 2.25).x - pl.x);
  let fy = (uv.y - pb.y) / max(pl.y - pb.y, 1e-5);
  let centerX = mix(pb.x, pl.x, clamp(fy, 0.0, 1.0));
  let px = vec2f(1.0 / u.resTime.x, 1.0 / u.resTime.y);

  if (fy >= 0.0 && fy <= 0.91) {
    let w = mix(wb, wt, clamp(fy / 0.91, 0.0, 1.0));
    let dx = abs(uv.x - centerX);
    let aa = max(px.x * 1.4, w * 0.015);
    let mask = 1.0 - smoothstep(w - aa, w + aa, dx);
    let worldY = baseY + fy / 0.91 * (lamp.y - 3.2 - baseY);
    let band = fract(worldY / 7.2);
    var baseCol = mix(vec3f(0.82, 0.84, 0.82), vec3f(0.55, 0.12, 0.10), step(0.68, band));
    let shade = 0.48 + 0.52 * (1.0 - clamp(dx / max(w, 1e-6), 0.0, 1.0));
    // 小窗。
    let wy = fract(worldY / 5.0);
    let windowMask = step(abs(uv.x - centerX), w * 0.18) * step(abs(wy - 0.52), 0.10);
    baseCol = mix(baseCol, vec3f(1.0, 0.78, 0.36), windowMask * 0.9);
    let foggedTower = mix(baseCol * shade, fogCol, clamp((1.0 - direct) * 0.94, 0.0, 0.97));
    col = mix(col, foggedTower, clamp(mask, 0.0, 1.0));
  }

  // 灯室平台与穹顶。
  let lanternUvY = pl.y - px.y * 2.0;
  let lh = abs(project(cam, lamp + cam.up * 1.7).y - pl.y);
  let lw = wt * 1.35;
  let ldx = abs(uv.x - pl.x);
  let ldy = abs(uv.y - lanternUvY);
  let boxMask = (1.0 - smoothstep(lw, lw + px.x * 1.5, ldx)) *
                (1.0 - smoothstep(lh * 0.72, lh * 0.72 + px.y * 1.5, ldy));
  let lanternMetal = mix(vec3f(0.12, 0.16, 0.20), fogCol, (1.0 - direct) * 0.9);
  col = mix(col, lanternMetal, boxMask * 0.92);
  let glass = (1.0 - smoothstep(lw * 0.72, lw * 0.9, ldx)) *
              (1.0 - smoothstep(lh * 0.45, lh * 0.62, ldy));
  col += u.lightColor.rgb * glass * 0.75 * direct;

  // 灯光辉光与星芒。
  let asp = u.resTime.x / u.resTime.y;
  let d = length((uv - pl) * vec2f(asp, 1.0));
  let glowSize = select(0.16, 0.055, shipView);
  col += u.lightColor.rgb * exp(-d * 18.0 / glowSize) * 1.25 * direct;
  col += u.lightColor.rgb * exp(-d * 110.0) * 2.4 * direct;
  let spikeH = exp(-abs(uv.y - pl.y) * u.resTime.y * 0.55) * exp(-abs(uv.x - pl.x) * 7.0);
  let spikeV = exp(-abs(uv.x - pl.x) * u.resTime.x * 0.55) * exp(-abs(uv.y - pl.y) * 7.0);
  col += u.lightColor.rgb * (spikeH + spikeV) * 0.35 * direct;
  // 浓雾把直接灯光化成一团低对比漫射亮斑。
  col += fogCol * exp(-d * 5.0 / max(glowSize, 0.04)) * (1.0 - direct) * 0.22;
  return col;
}

fn renderExteriorOrShip(uv: vec2f, shipView: bool) -> vec3f {
  let aspect = u.resTime.x / u.resTime.y;
  let t = u.resTime.z;
  let sigma = u.fog.x;
  var ro: vec3f;
  var aim: vec3f;
  var tanH: f32;

  if (shipView) {
    let d = u.obs.x;
    let b = u.obs.y;
    ro = vec3f(d * sin(b), u.obs.z + sin(t * 0.7) * 0.18, d * cos(b));
    aim = vec3f(0.0, u.lightColor.w, 0.0);
    tanH = u.obs.w;
  } else {
    ro = vec3f(48.0 + sin(t * 0.05) * 1.2, 15.5, 78.0);
    aim = vec3f(0.0, u.lightColor.w * 0.56, 0.0);
    tanH = tan(radians(43.0) * 0.5);
  }

  let cam = lookCamera(ro, aim, tanH, aspect);
  let rd = rayDir(cam, uv);
  let lamp = vec3f(0.0, u.lightColor.w, 0.0);

  var surfaceT = 1000000.0;
  var col = skyColor(rd, t);
  if (rd.y < -0.001) {
    let ts = -ro.y / rd.y;
    if (ts > 0.0 && ts < surfaceT) {
      surfaceT = ts;
      col = seaSurface(ro, rd, ts, sigma, t);
    }
  }

  // 远景雾幕。
  let bgFog = 1.0 - exp(-sigma * select(900.0, u.obs.x, shipView));
  col = mix(col, vec3f(0.31, 0.38, 0.49), clamp(bgFog * 0.55, 0.0, 0.82));

  if (u.flags.y > 0.5 || u.flags.z > 0.5) {
    let nPanels = u32(clamp(u.lens.x, 1.0, 16.0) + 0.5);
    let tLimit = min(surfaceT, 150000.0);
    for (var i = 0u; i < nPanels; i = i + 1u) {
      let phi = u.beam.w + f32(i) * TAU / f32(nPanels);
      // 方位约定与 physics/极坐标图一致：φ=0 指向 +z（海图上方）。
      let axis = vec3f(sin(phi), 0.0, cos(phi));
      let mu = clamp(-dot(rd, axis), -1.0, 1.0);
      let phase = miePhase(mu, 0.86);
      if (u.flags.z > 0.5) {
        col += coneScatter(ro, rd, lamp, axis, u.beam.x, 0.32, 1.0, phase, tLimit);
      }
      if (u.flags.y > 0.5) {
        col += coneScatter(ro, rd, lamp, axis, u.beam.x + u.fog.w * 1.35, 1.35, 0.24, phase, tLimit);
      }
    }
  }

  col = drawTower(col, uv, cam, lamp, t, shipView);

  if (!shipView) {
    // 前景海岬剪影。
    let cliffLine = 0.16 + 0.035 * sin(uv.x * 9.0) + 0.018 * noise2(vec2f(uv.x * 18.0, 3.0));
    if (uv.y < cliffLine) {
      col = mix(col, vec3f(0.025, 0.035, 0.04), 0.96);
    }
  } else {
    // 船舷、栏杆与驾驶台轮廓。
    if (uv.y < 0.105) {
      col = mix(col, vec3f(0.015, 0.022, 0.03), 0.98);
    }
    let railY = 0.145 + sin(t * 0.7) * 0.004;
    let railD = abs(uv.y - railY);
    col = mix(col, vec3f(0.55, 0.62, 0.68), (1.0 - smoothstep(0.002, 0.006, railD)) * 0.75);
    for (var i = 0; i < 9; i = i + 1) {
      let x = f32(i) / 8.0;
      let post = sdSegment(uv, vec2f(x, 0.105), vec2f(x + 0.006 * sin(t * 0.7), railY));
      col = mix(col, vec3f(0.45, 0.52, 0.58), (1.0 - smoothstep(0.001, 0.004, post)) * 0.7);
    }
    if (uv.x > 0.82 && uv.y < 0.22) {
      col = mix(col, vec3f(0.03, 0.045, 0.055), 0.92);
    }
  }

  // 夜景色调、暗角和 gamma。
  col = col / (1.0 + col * 0.32);
  let vig = smoothstep(1.25, 0.25, length(uv - 0.5));
  col *= mix(0.72, 1.0, vig);
  return pow(max(col, vec3f(0.0)), vec3f(0.4545));
}

fn renderPanelInset(inputCol: vec3f, uv: vec2f) -> vec3f {
  var col = inputCol;
  let center = vec2f(0.855, 0.52);
  let size = vec2f(0.125, 0.31);
  let boxD = sdBox(uv - center, size + 0.012);
  col = mix(col, vec3f(0.025, 0.055, 0.085), (1.0 - smoothstep(0.002, 0.006, boxD)) * 0.92);
  col += vec3f(0.2, 0.75, 0.95) * exp(-abs(boxD) * 260.0) * 0.8;

  let aspect = u.resTime.x / u.resTime.y;
  let q = vec2f((uv.x - center.x) * aspect, uv.y - center.y) / size.y;
  let r = length(q);
  let a = atan2(q.y, q.x);
  let nPanels = u32(u.lens.x + 0.5);
  let rot = u.beam.w;

  // 透镜环。
  col += vec3f(0.35, 0.85, 1.0) * exp(-abs(r - 0.62) * 90.0) * 0.9;
  col += vec3f(0.2, 0.55, 0.75) * exp(-abs(r - 0.50) * 120.0) * 0.45;

  // 面板分隔。
  let sector = TAU / f32(nPanels);
  for (var i = 0u; i < nPanels; i = i + 1u) {
    let bearing = rot + f32(i) * sector;
    // 方位 0° 朝 +y（海图上方），转换为 atan2 标准角。
    let pa = PI * 0.5 - bearing;
    let d = abs(wrapAngle(a - pa));
    let radialMask = smoothstep(0.42, 0.50, r) * (1.0 - smoothstep(0.64, 0.72, r));
    col += vec3f(0.65, 0.95, 1.0) * (1.0 - smoothstep(0.012, 0.025, d)) * radialMask;
  }

  // 每块面板对应的窄光束，半角与数值模型完全相同。
  for (var i = 0u; i < nPanels; i = i + 1u) {
    let bearing = rot + f32(i) * sector;
    let pa = PI * 0.5 - bearing;
    let d = abs(wrapAngle(a - pa));
    let cone = (1.0 - smoothstep(u.beam.x * 0.82, u.beam.x * 1.18, d)) *
               smoothstep(0.60, 0.72, r) * (1.0 - smoothstep(1.05, 1.18, r));
    col += u.lightColor.rgb * cone * 0.9;
  }
  col += u.lightColor.rgb * exp(-r * 18.0) * 1.4;
  return col;
}

fn wrapAngle(a: f32) -> f32 {
  var x = a;
  while (x > PI) { x = x - TAU; }
  while (x < -PI) { x = x + TAU; }
  return x;
}

fn renderSection(uv: vec2f) -> vec3f {
  var col = vec3f(0.025, 0.045, 0.075);
  let gridUv = uv * vec2f(18.0, 10.0);
  let grid = abs(fract(gridUv) - 0.5);
  let gridLine = (1.0 - smoothstep(0.02, 0.055, min(grid.x, grid.y))) * 0.12;
  col += vec3f(0.2, 0.55, 0.7) * gridLine;

  let mainAspect = (u.resTime.x * 0.70) / u.resTime.y;
  let muv = vec2f(uv.x / 0.70, uv.y);
  // 宽屏优先纵向充满；窄屏按横向包围盒缩小，避免另一侧透镜被裁掉。
  let scaleM = max(3.9, 3.85 / max(mainAspect, 0.25));
  let p = vec2f((muv.x - 0.5) * scaleM * mainAspect, (muv.y - 0.5) * scaleM);

  let f = u.lens.y;
  let glass = vec3f(0.35, 0.82, 1.0);
  let rayC = u.lightColor.rgb;

  // 中心光源和焦距标注线。
  col += rayC * exp(-length(p) * 20.0) * 1.8;
  col = addSegment(col, p, vec2f(0.0, -1.42), vec2f(0.0, 1.42), 0.006, vec3f(0.9, 0.7, 0.25), 0.45);
  col = addSegment(col, p, vec2f(0.0, -1.34), vec2f(f, -1.34), 0.006, vec3f(0.7, 0.85, 0.95), 0.55);

  for (var sideI = 0; sideI < 2; sideI = sideI + 1) {
    let sx = select(-1.0, 1.0, sideI == 1);
    // 中央折射环：7 圈。
    for (var j = -3; j <= 3; j = j + 1) {
      let y = f32(j) * 0.145;
      let tooth = 0.075 + 0.018 * cos(f32(j) * 1.7);
      let a = vec2f(sx * f, y - 0.055);
      let b = vec2f(sx * (f + sx * tooth), y);
      let c = vec2f(sx * f, y + 0.055);
      col = addSegment(col, p, a, b, 0.010, glass, 0.9);
      col = addSegment(col, p, b, c, 0.010, glass, 0.9);
      col = addSegment(col, p, c, a, 0.006, glass * 0.65, 0.55);
    }

    // 折射光路：有限光源尺寸 -> 半高宽等于 u.beam.x。
    if (u.flags.w > 0.5) {
      for (var k = -2; k <= 2; k = k + 1) {
        let spread = f32(k) / 2.0 * u.beam.x;
        let y0 = f32(k) * 0.105;
        let lensP = vec2f(sx * f, y0);
        let srcP = vec2f(sx * 0.018 * f32(k), -0.018 * f32(k));
        let dir = normalize(vec2f(sx, spread * select(1.0, 1.0, sx > 0.0)));
        let endP = lensP + dir * 1.18;
        col = addSegment(col, p, srcP, lensP, 0.006, rayC, 0.52);
        col = addSegment(col, p, lensP, endP, 0.008, rayC, 0.85);
        col = addPhoton(col, p, srcP, lensP, f32(k + 2) * 0.13, 0.42, u.resTime.z, rayC);
        col = addPhoton(col, p, lensP, endP, 0.25 + f32(k + 2) * 0.11, 0.55, u.resTime.z, rayC);
      }
    }

    // 上下全反射棱镜。
    if (u.extras.x > 0.5) {
      for (var syI = 0; syI < 2; syI = syI + 1) {
        let sy = select(-1.0, 1.0, syI == 1);
        for (var k = 0; k < 3; k = k + 1) {
          let yy = sy * (0.66 + f32(k) * 0.22);
          let A = vec2f(sx * (f - 0.08), yy - sy * 0.17);
          let B = vec2f(sx * (f + 0.13), yy);
          let C = vec2f(sx * (f + 0.02), yy + sy * 0.13);
          let Dp = vec2f(sx * (f - 0.10), yy + sy * 0.08);
          col = addSegment(col, p, A, B, 0.012, glass, 0.95);
          col = addSegment(col, p, B, C, 0.012, glass, 0.95);
          col = addSegment(col, p, C, Dp, 0.010, glass, 0.75);
          col = addSegment(col, p, Dp, A, 0.010, glass, 0.75);

          if (u.flags.w > 0.5) {
            let S = vec2f(0.0, 0.0);
            let Eout = vec2f(sx * (f + 0.43), B.y);
            col = addSegment(col, p, S, A, 0.006, rayC, 0.48);
            col = addSegment(col, p, A, B, 0.007, rayC, 0.65);
            col = addSegment(col, p, B, Eout, 0.009, rayC, 0.95);
            col = addPhoton(col, p, A, B, f32(k) * 0.19 + f32(syI) * 0.2, 0.5, u.resTime.z, rayC);
            col = addPhoton(col, p, B, Eout, 0.4 + f32(k) * 0.17, 0.58, u.resTime.z, rayC);
            // TIR 反射标记。
            let n = normalize(vec2f(-sx * 0.45, sy * 0.89));
            col += vec3f(1.0, 0.95, 0.75) * exp(-length(p - B) * 34.0) * 0.9;
            col = addSegment(col, p, B - n * 0.10, B + n * 0.10, 0.004, vec3f(1.0), 0.8);
          }
        }
      }
    }
  }

  // 面板数 top-down 插图。
  col = renderPanelInset(col, uv);

  // 边框。
  let border = max(abs(uv.x - 0.012) - 0.012, abs(uv.y - 0.5) - 0.47);
  col += vec3f(0.25, 0.75, 0.95) * exp(-max(border, 0.0) * 220.0) * 0.35;
  return pow(max(col, vec3f(0.0)), vec3f(0.85));
}

fn renderOptics(uv: vec2f) -> vec3f {
  var col = vec3f(0.022, 0.04, 0.068);
  let divider = abs(uv.x - 0.5);
  col += vec3f(0.3, 0.8, 1.0) * exp(-divider * 500.0) * 0.5;

  // 左：折射环特写。
  let p1 = vec2f((uv.x * 2.0 - 0.5) * 3.2, (uv.y - 0.5) * 3.2);
  let glass = vec3f(0.34, 0.82, 1.0);
  let tooth = array<vec2f, 5>(
    vec2f(-0.55, -0.55), vec2f(-0.18, -0.28), vec2f(0.05, -0.05),
    vec2f(-0.16, 0.22), vec2f(-0.52, 0.52)
  );
  for (var i = 0; i < 4; i = i + 1) {
    col = addSegment(col, p1, tooth[i], tooth[i + 1], 0.018, glass, 1.0);
  }
  col = addSegment(col, p1, tooth[0], tooth[4], 0.014, glass * 0.7, 0.7);
  let S = vec2f(-1.35, -0.82);
  let A = vec2f(-0.34, -0.18);
  let B = vec2f(-0.04, -0.02);
  let E = vec2f(1.25, 0.02 + 0.025 * sin(u.resTime.z * 0.8));
  col = addSegment(col, p1, S, A, 0.012, u.lightColor.rgb, 0.95);
  col = addSegment(col, p1, A, B, 0.012, u.lightColor.rgb, 0.75);
  col = addSegment(col, p1, B, E, 0.014, u.lightColor.rgb, 1.1);
  col = addPhoton(col, p1, S, A, 0.1, 0.45, u.resTime.z, u.lightColor.rgb);
  col = addPhoton(col, p1, B, E, 0.55, 0.55, u.resTime.z, u.lightColor.rgb);
  // 法线。
  col = addSegment(col, p1, B + vec2f(-0.25, -0.35), B + vec2f(0.25, 0.35), 0.006, vec3f(0.7, 0.85, 1.0), 0.5);

  // 右：TIR 特写，反射方向由 WGSL reflect 实时计算。
  let p2 = vec2f(((uv.x - 0.5) * 2.0 - 0.5) * 3.2, (uv.y - 0.5) * 3.2);
  let I = normalize(vec2f(0.60, 0.80));
  let N = normalize(vec2f(0.4472, -0.8944));
  let R = reflect(I, N);
  let hit = vec2f(0.05, 0.0);
  let incomingA = hit - I * 1.35;
  let outgoingB = hit + R * 1.45;
  // 棱镜轮廓。
  let prism = array<vec2f, 4>(hit + vec2f(-0.75, -0.55), hit + vec2f(0.72, 0.36), hit + vec2f(-0.55, 0.78), hit + vec2f(-0.75, -0.55));
  for (var i = 0; i < 3; i = i + 1) {
    col = addSegment(col, p2, prism[i], prism[i + 1], 0.02, glass, 0.95);
  }
  col = addSegment(col, p2, incomingA, hit, 0.014, u.lightColor.rgb, 1.0);
  col = addSegment(col, p2, hit, outgoingB, 0.016, u.lightColor.rgb, 1.15);
  col = addPhoton(col, p2, incomingA, hit, 0.2, 0.5, u.resTime.z, u.lightColor.rgb);
  col = addPhoton(col, p2, hit, outgoingB, 0.62, 0.55, u.resTime.z, u.lightColor.rgb);
  col = addSegment(col, p2, hit - N * 0.55, hit + N * 0.55, 0.007, vec3f(0.8, 0.9, 1.0), 0.65);
  col += vec3f(1.0, 0.95, 0.75) * exp(-length(p2 - hit) * 22.0) * 1.1;

  // 底部发散角示意带。
  let bandY = 0.10;
  let dCenter = abs(uv.y - bandY);
  let halfUv = u.beam.x * 0.9;
  let xNorm = abs(uv.x - 0.5);
  let angleBand = (1.0 - smoothstep(halfUv * 0.82, halfUv * 1.18, xNorm * 0.18)) *
                  exp(-dCenter * 90.0);
  col += u.lightColor.rgb * angleBand * 0.28;

  return pow(max(col, vec3f(0.0)), vec3f(0.9));
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  let mode = u32(u.flags.x + 0.5);
  var color = vec3f(0.0);
  if (mode == 1u) {
    color = renderSection(in.uv);
  } else if (mode == 2u) {
    color = renderOptics(in.uv);
  } else if (mode == 3u) {
    color = renderExteriorOrShip(in.uv, true);
  } else {
    color = renderExteriorOrShip(in.uv, false);
  }
  return vec4f(color, 1.0);
}
`;
