import { clamp } from '../physics';
import { store } from '../state';
import { h, sliderRow, toggleRow, formulaBox } from '../ui/components';
import { createStageShell } from '../ui/stage';
import type { PageHandle } from './types';

export function renderOpticsPage(): PageHandle {
  const shell = createStageShell(
    '光路讲解 · 折射汇聚与全反射',
    '左：Snell 折射环；右：WGSL reflect 实时计算的 TIR 反射方向',
    'optics'
  );

  const angleOut = h('div', { class: 'snell-output' }, []);
  let incidenceDeg = 58;
  let nGlass = 1.52;

  const angleSlider = sliderRow({
    label: '光线入射角 θ₁（玻璃内）', min: 5, max: 88, step: 1, value: incidenceDeg,
    format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => { incidenceDeg = v; updateSnell(); }
  });
  const nSlider = sliderRow({
    label: '玻璃折射率 n₁', min: 1.45, max: 1.62, step: 0.01, value: nGlass,
    format: (v) => v.toFixed(2),
    onInput: (v) => { nGlass = v; updateSnell(); }
  });

  function updateSnell(): void {
    const theta1 = incidenceDeg * Math.PI / 180;
    const nAir = 1;
    const sinTheta2 = nGlass / nAir * Math.sin(theta1);
    const critical = Math.asin(nAir / nGlass) * 180 / Math.PI;
    const tir = sinTheta2 > 1;
    angleOut.className = `snell-output ${tir ? 'tir' : 'refract'}`;
    if (tir) {
      angleOut.innerHTML = `
        <div class="big">全反射 TIR</div>
        <div>临界角 θc = <b>${critical.toFixed(2)}°</b></div>
        <div>当前 θ₁ = <b>${incidenceDeg.toFixed(0)}°</b> &gt; θc，光不射入空气，而是按反射定律返回透镜。</div>
      `;
    } else {
      const theta2 = Math.asin(clamp(sinTheta2, -1, 1)) * 180 / Math.PI;
      angleOut.innerHTML = `
        <div class="big">折射出射 θ₂ = ${theta2.toFixed(2)}°</div>
        <div>临界角 θc = <b>${critical.toFixed(2)}°</b></div>
        <div>Snell：${nGlass.toFixed(2)}·sin ${incidenceDeg.toFixed(0)}° = 1.00·sin θ₂</div>
      `;
    }
  }

  const steps = [
    ['1', '点光源发散', '灯室中央的金属卤化物/LED 光源不是几何点，有限弧径 d 被焦距 f 的透镜成像到无穷远，留下 θ≈2atan(d/2f) 的发散角。'],
    ['2', '中央环带折射', '中央区域的菲涅尔锯齿把厚透镜拆成一串环带；每个环的斜面按 Snell 定律把中角度光线推向水平。'],
    ['3', '上下棱镜 TIR', '上下边缘光线入射角超过临界角，棱镜内斜面充当反射面；反射后再经出射面修正为水平窄光束。'],
    ['4', '面板旋转扫描', 'N 块面板在方位上均布，每块产生一道光束。透镜转一圈，远处观察者收到 N 次闪光。'],
    ['5', '雾中传播', '雾滴以米氏散射把光路撒向相机；前向散射用 Cornette–Shanks 相位函数近似，消光系数由能见度导出。']
  ];

  const el = h('div', { class: 'page-grid optics-grid' }, [
    shell.card,
    h('aside', { class: 'side-panel' }, [
      h('section', { class: 'card control-card' }, [
        h('h3', {}, ['光路图层']),
        toggleRow('运动光子/光路', store.state.render.showRays, (v) => store.updateRender({ showRays: v })),
        toggleRow('TIR 反射棱镜', store.state.render.showTir, (v) => store.updateRender({ showTir: v }))
      ]),
      h('section', { class: 'card control-card' }, [
        h('h3', {}, ['Snell / TIR 小实验']),
        angleSlider, nSlider, angleOut
      ]),
      h('section', { class: 'card control-card steps-card' }, [
        h('h3', {}, ['五步看懂灯塔光束']),
        ...steps.map(([num, title, text]) => h('div', { class: 'step-item' }, [
          h('span', { class: 'step-num' }, [num]),
          h('div', {}, [h('strong', {}, [title]), h('p', {}, [text])])
        ]))
      ]),
      formulaBox('米氏散射体积光', 'I_sca ∝ P_Mie(g,θ) · β_sca ∫e^(-σs_光源)e^(-σs_相机)ds', '着色器对光束圆锥做解析积分；雾越浓，σ 越大，可见长度越短、多次散射光晕越宽。')
    ])
  ]);

  updateSnell();
  return { el, destroy: () => shell.destroy() };
}
