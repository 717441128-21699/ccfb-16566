import {
  ALLARD_THRESHOLD_LUX,
  allardIlluminance,
  getFlashTiming,
  getRangeReport,
  observedFlash,
  wrapPi
} from '../physics';
import { store } from '../state';
import { h, sliderRow, statCard } from '../ui/components';
import { createStageShell } from '../ui/stage';
import type { PageHandle } from './types';

export function renderObserverPage(): PageHandle {
  let latestSim = 0;
  const hudFlash = h('strong', { class: 'hud-flash' }, ['0%']);
  const hudIllum = h('strong', { class: 'hud-illum' }, ['0 lx']);
  const hudState = h('span', { class: 'hud-state' }, ['等待光束']);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const marker = document.createElementNS(SVG_NS, 'line');
  marker.setAttribute('x1', '0');
  marker.setAttribute('x2', '0');
  marker.setAttribute('y1', '0');
  marker.setAttribute('y2', '150');
  marker.setAttribute('stroke', '#ffd36a');
  marker.setAttribute('stroke-width', '2');
  const chartArea = document.createElementNS(SVG_NS, 'path');
  chartArea.setAttribute('fill', 'url(#flashFill)');
  chartArea.setAttribute('stroke', '#ffd36a');
  chartArea.setAttribute('stroke-width', '2');

  const chartSvg = document.createElementNS(SVG_NS, 'svg');
  chartSvg.setAttribute('viewBox', '0 0 600 150');
  chartSvg.setAttribute('preserveAspectRatio', 'none');
  chartSvg.classList.add('flash-chart');
  chartSvg.innerHTML = `
    <defs><linearGradient id="flashFill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd36a" stop-opacity=".55"/>
      <stop offset="100%" stop-color="#ffd36a" stop-opacity=".03"/>
    </linearGradient></defs>
    <line x1="0" x2="600" y1="75" y2="75" stroke="rgba(255,255,255,.12)"/>
  `;
  chartArea.setAttribute('fill', 'url(#flashFill)');
  chartSvg.append(chartArea, marker);

  const chartCard = h('section', { class: 'card chart-card' }, [
    h('div', { class: 'chart-head' }, [
      h('h3', {}, ['船载记录仪：闪光包络']),
      h('span', { class: 'control-hint' }, ['半高宽 = 画面闪光时长；竖线与 WebGPU 旋转时钟同步'])
    ]),
    chartSvg,
    h('div', { class: 'chart-axis' }, [h('span', {}, ['过去/周期起点']), h('span', {}, ['时间 →'])])
  ]);

  const shell = createStageShell(
    '海上船视角 · 观察点设置',
    '按真实距离、方位、眼高和变焦观察灯塔；亮度走 Allard 衰减',
    'ship',
    (sim) => {
      latestSim = sim;
      updateFrameHud();
      const s = store.state;
      const timing = getFlashTiming(s);
      const windowS = Math.min(24, Math.max(6, timing.flashPeriodS * 4));
      const x = ((sim % windowS) / windowS) * 600;
      marker.setAttribute('x1', String(x));
      marker.setAttribute('x2', String(x));
      const beamGroup = document.querySelector<SVGGElement>('.polar-beams');
      if (beamGroup) {
        beamGroup.setAttribute('transform', `rotate(${timing.angularSpeedRadS * sim * 180 / Math.PI})`);
      }
    }
  );

  const hud = h('div', { class: 'ship-hud' }, [
    h('div', {}, [h('span', {}, ['瞬时光束响应 ']), hudFlash]),
    h('div', {}, [h('span', {}, ['Allard 照度 ']), hudIllum]),
    h('div', { class: 'hud-state-row' }, [hudState])
  ]);
  shell.card.querySelector('.canvas-wrap')?.append(hud);

  const distanceSlider = sliderRow({
    label: '船—灯塔距离 D', min: 0.5, max: 60, step: 0.1, value: store.state.observer.distanceKm,
    format: (v) => v < 1 ? `${(v * 1000).toFixed(0)} m` : `${v.toFixed(1)} km`,
    onInput: (v) => store.updateObserver({ distanceKm: v })
  });
  const bearingSlider = sliderRow({
    label: '方位角（0° = 正对初始光束）', min: -180, max: 180, step: 0.1, value: store.state.observer.bearingDeg,
    format: (v) => `${v.toFixed(1)}°`, onInput: (v) => store.updateObserver({ bearingDeg: v })
  });
  const eyeSlider = sliderRow({
    label: '观察员眼高', min: 2, max: 40, step: 0.5, value: store.state.observer.eyeHeightM,
    format: (v) => `${v.toFixed(1)} m`, onInput: (v) => store.updateObserver({ eyeHeightM: v })
  });
  const zoomSlider = sliderRow({
    label: '望远/视场角', min: 3, max: 55, step: 0.5, value: store.state.observer.zoomDeg,
    format: (v) => `${v.toFixed(1)}°`, onInput: (v) => store.updateObserver({ zoomDeg: v })
  });
  const speedSlider = sliderRow({
    label: '时间倍率', min: 0.1, max: 4, step: 0.1, value: store.state.observer.timeScale,
    format: (v) => `${v.toFixed(1)}×`, onInput: (v) => store.updateObserver({ timeScale: v })
  });

  const pauseBtn = h('button', { class: 'btn', type: 'button' }, [store.state.observer.paused ? '继续旋转' : '暂停旋转']);
  pauseBtn.addEventListener('click', () => {
    store.updateObserver({ paused: !store.state.observer.paused });
    pauseBtn.textContent = store.state.observer.paused ? '继续旋转' : '暂停旋转';
  });
  const alignBtn = h('button', { class: 'btn primary', type: 'button' }, ['让船对准当前面板']);
  alignBtn.addEventListener('click', () => {
    const s = store.state;
    const t = getFlashTiming(s);
    const b = s.observer.bearingDeg * Math.PI / 180;
    const pitch = 2 * Math.PI / s.panelCount;
    const rotation = t.angularSpeedRadS * latestSim;
    const nearest = rotation + Math.round((b - rotation) / pitch) * pitch;
    store.updateObserver({
      bearingDeg: wrapPi(nearest) * 180 / Math.PI,
      paused: true
    });
    pauseBtn.textContent = '继续旋转';
  });

  const mapWrap = h('div', { class: 'polar-map-wrap' }, []);
  mapWrap.innerHTML = `
    <svg class="polar-map" viewBox="-110 -110 220 220" role="img" aria-label="观察点极坐标图">
      <circle cx="0" cy="0" r="92" class="map-outer"/>
      <circle cx="0" cy="0" r="61" class="map-grid"/>
      <circle cx="0" cy="0" r="30.7" class="map-grid"/>
      <line x1="-92" y1="0" x2="92" y2="0" class="map-axis"/>
      <line x1="0" y1="-92" x2="0" y2="92" class="map-axis"/>
      <circle class="map-range" cx="0" cy="0" r="80"/>
      <g class="polar-beams"></g>
      <polygon points="0,-10 3,0 0,4 -3,0" class="map-lighthouse"/>
      <circle class="map-ship" cx="0" cy="-30" r="5"/>
      <text x="6" y="-96" class="map-text">0°</text>
      <text x="80" y="4" class="map-text">90°</text>
    </svg>`;
  const svg = mapWrap.querySelector('svg') as SVGSVGElement;
  const shipDot = mapWrap.querySelector('.map-ship') as SVGCircleElement;
  const rangeCircle = mapWrap.querySelector('.map-range') as SVGCircleElement;
  const beamGroup = mapWrap.querySelector('.polar-beams') as SVGGElement;
  for (let i = 0; i < store.state.panelCount; i++) {
    const a = i * 2 * Math.PI / store.state.panelCount;
    const x2 = Math.sin(a) * 92;
    const y2 = -Math.cos(a) * 92;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
    line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
    line.setAttribute('class', 'map-beam');
    beamGroup.append(line);
  }

  function pointerToMap(ev: PointerEvent): void {
    const rect = svg.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 220 - 110;
    const y = ((ev.clientY - rect.top) / rect.height) * 220 - 110;
    const km = Math.min(60, Math.max(0.5, Math.hypot(x, y) / 92 * 60));
    const bearing = Math.atan2(x, -y) * 180 / Math.PI;
    store.updateObserver({ distanceKm: km, bearingDeg: bearing });
  }
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointerToMap(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (e.buttons === 1) pointerToMap(e);
  });

  const metrics = h('div', { class: 'stat-grid' }, []);
  const benchmarkOut = h('div', { class: 'benchmark-output' }, ['尚未运行 4K 压力测试。']);
  const benchmarkBtn = h('button', { class: 'btn primary', type: 'button' }, ['运行真 3840×2160 / 180 帧测试']);
  benchmarkBtn.addEventListener('click', async () => {
    if (!shell.renderer) {
      benchmarkOut.textContent = 'WebGPU 渲染器仍在初始化或不可用。';
      return;
    }
    benchmarkBtn.disabled = true;
    benchmarkOut.textContent = '测试中：强制 backing store 为 3840×2160，请保持页面可见…';
    const result = await shell.renderer.benchmark4K(180);
    benchmarkBtn.disabled = false;
    if (!result) {
      benchmarkOut.textContent = '测试未完成。';
      return;
    }
    benchmarkOut.innerHTML = `
      <b class="${result.pass60 ? 'pass-text' : 'warn-text'}">${result.fps.toFixed(1)} FPS</b>
      · 平均 ${result.avgFrameMs.toFixed(2)} ms/帧
      · ${result.width}×${result.height}
      · ${result.pass60 ? '达到 ≥60 FPS 验收线（按当前 GPU/浏览器）' : '未稳定达到 60 FPS；请使用自适应/性能档或更低功耗设备测试'}
    `;
  });

  const settings = h('aside', { class: 'side-panel' }, [
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['观察点设置']),
      mapWrap,
      distanceSlider, bearingSlider, eyeSlider, zoomSlider, speedSlider,
      h('div', { class: 'button-row' }, [pauseBtn, alignBtn])
    ]),
    h('section', { class: 'card control-card' }, [h('h3', {}, ['射程与观测']), metrics]),
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['4K / 60fps 性能验收']),
      h('p', { class: 'control-hint' }, ['测试会临时把 WebGPU canvas 设为真 4K，即使窗口不是 4K 也会提交 829 万像素/帧的负载。']),
      benchmarkBtn, benchmarkOut
    ])
  ]);

  const center = h('div', { class: 'visual-column' }, [shell.card, chartCard]);
  const el = h('div', { class: 'page-grid observer-grid' }, [center, settings]);

  function updateFrameHud(): void {
    const s = store.state;
    const b = s.observer.bearingDeg * Math.PI / 180;
    const flash = observedFlash(latestSim, b, s);
    const axialE = allardIlluminance(s.observer.distanceKm * 1000, s);
    const observedE = axialE * flash;
    hudFlash.textContent = `${(flash * 100).toFixed(0)}%`;
    hudIllum.textContent = observedE < 1e-12
      ? '≈0 lx（束外）'
      : observedE < 0.001
        ? `${observedE.toExponential(2)} lx`
        : `${observedE.toFixed(3)} lx`;
    if (axialE < ALLARD_THRESHOLD_LUX) {
      hudState.textContent = 'Allard 射程外';
      hudState.className = 'hud-state bad';
    } else if (flash > 0.5) {
      hudState.textContent = '闪光到达！';
      hudState.className = 'hud-state good';
    } else {
      hudState.textContent = '等待光束扫描';
      hudState.className = 'hud-state';
    }
  }

  function updateChart(): void {
    const s = store.state;
    const b = s.observer.bearingDeg * Math.PI / 180;
    const timing = getFlashTiming(s);
    const windowS = Math.min(24, Math.max(6, timing.flashPeriodS * 4));
    const samples = 720;
    let d = '';
    for (let i = 0; i <= samples; i++) {
      const t = windowS * i / samples;
      const v = observedFlash(t, b, s);
      const x = i / samples * 600;
      const y = 140 - v * 125;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    }
    d += 'L600,150 L0,150 Z';
    chartArea.setAttribute('d', d);
  }

  function update(): void {
    const s = store.state;
    pauseBtn.textContent = s.observer.paused ? '继续旋转' : '暂停旋转';
    const report = getRangeReport(s, s.lanternHeightM, s.observer.eyeHeightM);
    metrics.innerHTML = '';
    metrics.append(
      statCard('Allard 灯光射程', `${report.allardRangeKm.toFixed(2)} km`, `${report.allardRangeNm.toFixed(1)} nm`, 'accent'),
      statCard('地理视距', `${report.geographicRangeKm.toFixed(1)} km`, '4.12(√h₁+√h₂)'),
      statCard('有效可见距离', `${report.effectiveRangeKm.toFixed(1)} km`, '取 Allard/地理最小值', s.observer.distanceKm > report.effectiveRangeKm ? 'warn' : 'good')
    );
    const r = Math.min(92, report.allardRangeKm / 60 * 92);
    rangeCircle.setAttribute('r', String(r));
    shipDot.setAttribute('cx', String(Math.sin(s.observer.bearingDeg * Math.PI / 180) * s.observer.distanceKm / 60 * 92));
    shipDot.setAttribute('cy', String(-Math.cos(s.observer.bearingDeg * Math.PI / 180) * s.observer.distanceKm / 60 * 92));
    updateChart();
    updateFrameHud();
  }

  const unsub = store.subscribe(update);
  update();

  return {
    el,
    destroy() {
      unsub();
      shell.destroy();
    }
  };
}
