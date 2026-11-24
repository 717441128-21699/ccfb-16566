import { getFlashTiming } from '../physics';
import { store } from '../state';
import { h, sliderRow, toggleRow, formulaBox } from '../ui/components';
import { createSelfCheckPanel } from '../ui/selfcheck-panel';
import { createStageShell } from '../ui/stage';
import type { PageHandle } from './types';

export function renderSectionPage(): PageHandle {
  const shell = createStageShell(
    '菲涅尔透镜剖面 · 面板/折射环/TIR 棱镜',
    '主图为垂直剖面，右上为俯视面板分块与同角宽光束',
    'section'
  );

  const panelSlider = sliderRow({
    label: '环绕面板数 N', min: 2, max: 16, step: 1, value: store.state.panelCount,
    format: (v) => `${v} 块`, onInput: (v) => store.update({ panelCount: Math.round(v) })
  });
  const focalSlider = sliderRow({
    label: '焦距 f（图中光源到透镜距离）', min: 0.35, max: 1.6, step: 0.01, value: store.state.focalLengthM,
    format: (v) => `${v.toFixed(2)} m`, onInput: (v) => store.update({ focalLengthM: v })
  });
  const sourceSlider = sliderRow({
    label: '光源直径 d', min: 0.02, max: 0.12, step: 0.001, value: store.state.sourceDiameterM,
    format: (v) => `${(v * 1000).toFixed(0)} mm`, onInput: (v) => store.update({ sourceDiameterM: v })
  });

  const readout = h('div', { class: 'inline-readout' }, []);

  const el = h('div', { class: 'page-grid section-grid' }, [
    shell.card,
    h('aside', { class: 'side-panel' }, [
      h('section', { class: 'card control-card' }, [
        h('h3', {}, ['结构显示']),
        toggleRow('实时光路与光子', store.state.render.showRays, (v) => store.updateRender({ showRays: v })),
        toggleRow('上下全反射棱镜', store.state.render.showTir, (v) => store.updateRender({ showTir: v })),
        toggleRow('HTML 结构标注', store.state.render.showLabels, (v) => {
          store.updateRender({ showLabels: v });
          document.body.classList.toggle('hide-annotations', !v);
        })
      ]),
      h('section', { class: 'card control-card' }, [
        h('h3', {}, ['透镜参数']),
        panelSlider, focalSlider, sourceSlider, readout
      ]),
      h('section', { class: 'card control-card' }, [
        h('h3', {}, ['怎么读这张剖面']),
        formulaBox('中央折射环', 'n₁sinθ₁ = n₂sinθ₂', '一圈圈菲涅尔锯齿替代厚重凸透镜，把中角度光线折射到接近水平。'),
        formulaBox('上下 TIR 棱镜', 'θᵢ > θc = asin(n₂/n₁)', '高角度斜光进入棱镜后在内斜面全反射，再水平射出，减少灯高方向的光浪费。'),
        formulaBox('面板与光束', 'Tflash = 60 / (N·rpm)', '俯视插图中每块旋转面板对应一道窄光束；N 块均布时，远处看到 N 次/转。')
      ]),
      createSelfCheckPanel()
    ])
  ]);

  const annotations = h('div', { class: 'annotation-layer' }, [
    h('span', { class: 'anno anno-source' }, ['光源']),
    h('span', { class: 'anno anno-ring' }, ['中央折射环']),
    h('span', { class: 'anno anno-tir-top' }, ['上 TIR 棱镜']),
    h('span', { class: 'anno anno-tir-bottom' }, ['下 TIR 棱镜']),
    h('span', { class: 'anno anno-inset' }, [`${store.state.panelCount} 面板俯视`])
  ]);
  shell.card.querySelector('.canvas-wrap')?.append(annotations);

  function update(): void {
    const s = store.state;
    const t = getFlashTiming(s);
    readout.innerHTML = `
      <div><b>${s.panelCount}</b> 块面板 · 间距 <b>${t.panelPitchDeg.toFixed(1)}°</b></div>
      <div>发散全角 <b>${t.divergenceDeg.toFixed(2)}°</b> · 半角 <b>${(t.halfAngleRad * 180 / Math.PI).toFixed(2)}°</b></div>
      <div>转速 <b>${s.rpm.toFixed(2)} rpm</b> · 周期 <b>${t.flashPeriodS.toFixed(2)} s</b></div>
    `;
    const insetAnno = annotations.querySelector('.anno-inset');
    if (insetAnno) insetAnno.textContent = `${s.panelCount} 面板俯视`;
  }
  const unsub = store.subscribe(update);
  update();
  document.body.classList.toggle('hide-annotations', !store.state.render.showLabels);

  return {
    el,
    destroy() {
      unsub();
      shell.destroy();
      document.body.classList.remove('hide-annotations');
    }
  };
}
