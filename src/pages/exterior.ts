import {
  ALLARD_THRESHOLD_LUX,
  getFlashTiming,
  getRangeReport,
  LIGHTHOUSE_PRESETS
} from '../physics';
import { store } from '../state';
import { h, sliderRow, statCard, toggleRow } from '../ui/components';
import { createStageShell } from '../ui/stage';
import type { PageHandle } from './types';

export function renderExteriorPage(): PageHandle {
  const shell = createStageShell('灯塔外景 · 雾中体积光', '解析米氏散射圆锥积分；光束核心角宽与焦距模型一致', 'exterior');

  const presetSelect = h('select', { class: 'select-input', 'aria-label': '选择灯塔灯质' }) as HTMLSelectElement;
  for (const p of LIGHTHOUSE_PRESETS) {
    presetSelect.append(h('option', { value: p.id }, [`${p.name}｜${p.characteristic.split('—')[0].trim()}`]) as HTMLOptionElement);
  }
  presetSelect.value = store.state.presetId;
  presetSelect.addEventListener('change', () => store.applyPreset(presetSelect.value));

  const presetMeta = h('div', { class: 'preset-meta' }, []);
  const timingGrid = h('div', { class: 'stat-grid' }, []);
  const rangeGrid = h('div', { class: 'stat-grid' }, []);

  const panelSlider = sliderRow({
    label: '透镜面板数 N', min: 2, max: 16, step: 1, value: store.state.panelCount,
    format: (v) => `${v} 块`, onInput: (v) => store.update({ panelCount: Math.round(v) })
  });
  const focalSlider = sliderRow({
    label: '焦距 f', min: 0.35, max: 2.0, step: 0.01, value: store.state.focalLengthM,
    format: (v) => `${v.toFixed(2)} m`, onInput: (v) => store.update({ focalLengthM: v })
  });
  const sourceSlider = sliderRow({
    label: '光源有效直径 d', min: 0.02, max: 0.12, step: 0.001, value: store.state.sourceDiameterM,
    format: (v) => `${(v * 1000).toFixed(0)} mm`, hint: 'θ ≈ 2 atan(d / 2f)',
    onInput: (v) => store.update({ sourceDiameterM: v })
  });
  const rpmSlider = sliderRow({
    label: '转速', min: 0.2, max: 6, step: 0.05, value: store.state.rpm,
    format: (v) => `${v.toFixed(2)} r/min`, onInput: (v) => store.update({ rpm: v })
  });
  const visSlider = sliderRow({
    label: '气象能见度 V', min: 0.1, max: 30, step: 0.1, value: store.state.visibilityKm,
    format: (v) => v < 1 ? `${(v * 1000).toFixed(0)} m` : `${v.toFixed(1)} km`,
    hint: 'σ = 2.996 / V（Koschmieder）',
    onInput: (v) => store.update({ visibilityKm: v })
  });
  const intensitySlider = sliderRow({
    label: '轴向光强 I', min: 4, max: 6.5, step: 0.01, value: Math.log10(store.state.intensityCd),
    format: (v) => `${(10 ** v / 10000).toFixed(0)} 万 cd`,
    onInput: (v) => store.update({ intensityCd: Math.round(10 ** v) })
  });

  const qualitySelect = h('select', { class: 'select-input' }) as HTMLSelectElement;
  qualitySelect.append(
    h('option', { value: 'adaptive' }, ['自适应分辨率（推荐 4K）']) as HTMLOptionElement,
    h('option', { value: 'performance' }, ['性能优先 0.6×']) as HTMLOptionElement,
    h('option', { value: 'native' }, ['原生分辨率']) as HTMLOptionElement
  );
  qualitySelect.value = store.state.render.quality;
  qualitySelect.addEventListener('change', () => {
    store.updateRender({ quality: qualitySelect.value as 'adaptive' | 'performance' | 'native' });
    shell.renderer?.refreshQuality();
  });

  const panel = h('aside', { class: 'side-panel' }, [
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['灯塔与灯质']),
      presetSelect,
      presetMeta
    ]),
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['透镜与旋转']),
      panelSlider, focalSlider, sourceSlider, rpmSlider,
      h('div', { class: 'toggle-grid' }, [
        toggleRow('窄光束核心', store.state.render.showCoreBeams, (v) => store.updateRender({ showCoreBeams: v })),
        toggleRow('米氏雾体积光', store.state.render.showVolume, (v) => store.updateRender({ showVolume: v }))
      ])
    ]),
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['雾与灯光射程']),
      visSlider, intensitySlider,
      rangeGrid,
      h('p', { class: 'equation-note' }, [
        `Allard：E = I·e^(-σR)/R²；阈值 Eₜ = ${ALLARD_THRESHOLD_LUX.toExponential(1)} lx。`
      ])
    ]),
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['画面计算指标']),
      timingGrid
    ]),
    h('section', { class: 'card control-card' }, [
      h('h3', {}, ['性能策略']),
      qualitySelect,
      h('p', { class: 'control-hint' }, ['体积光不在 4K 上做长距离逐像素步进，而是对每个面板的光束圆锥做解析散射积分；自适应分辨率会在掉帧时自动降低 backing resolution。'])
    ])
  ]);

  const el = h('div', { class: 'page-grid exterior-grid' }, [shell.card, panel]);

  function update(): void {
    const s = store.state;
    const t = getFlashTiming(s);
    const r = getRangeReport(s, s.lanternHeightM, s.observer.eyeHeightM);
    presetSelect.value = s.presetId;
    qualitySelect.value = s.render.quality;
    presetMeta.innerHTML = '';
    presetMeta.append(
      h('div', { class: 'preset-name' }, [s.name]),
      h('div', {}, [s.waterArea]),
      h('div', {}, [s.order]),
      h('div', { class: 'characteristic' }, [s.characteristic])
    );

    timingGrid.innerHTML = '';
    timingGrid.append(
      statCard('闪光周期', `${t.flashPeriodS.toFixed(2)} s`, `60 / (N·rpm)`),
      statCard('闪光时长', `${(t.flashDurationS * 1000).toFixed(0)} ms`, 'FWHM = θ/ω'),
      statCard('光束发散角', `${t.divergenceDeg.toFixed(2)}°`, `半角 ${(t.halfAngleRad * 180 / Math.PI).toFixed(2)}°`),
      statCard('每分钟闪光', `${t.flashesPerMinute.toFixed(0)}`, `面板间距 ${t.panelPitchDeg.toFixed(1)}°`, t.panelsOverlap ? 'warn' : '')
    );
    if (t.panelsOverlap) {
      timingGrid.append(h('div', { class: 'inline-warning' }, ['当前发散角大于面板间距，相邻光束会重叠；教学模型仍按最亮包络计算。']));
    }

    rangeGrid.innerHTML = '';
    rangeGrid.append(
      statCard('Allard 射程', `${r.allardRangeNm.toFixed(1)} nm`, `${r.allardRangeKm.toFixed(2)} km`, 'accent'),
      statCard('地理视距', `${r.geographicRangeNm.toFixed(1)} nm`, `灯高 ${s.lanternHeightM}m / 眼高 ${s.observer.eyeHeightM}m`),
      statCard('大气透射率', `${r.transmissivityPerNm.toFixed(3)} /nm`, `σ=${r.extinctionPerKm.toFixed(3)} km⁻¹`)
    );
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
