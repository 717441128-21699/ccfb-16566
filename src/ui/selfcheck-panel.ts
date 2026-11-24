import { runSelfCheck, type CheckResult } from '../selfcheck';
import { store } from '../state';
import { h } from './components';

export function createSelfCheckPanel(): HTMLElement {
  const list = h('div', { class: 'check-list' }, []);
  const summary = h('div', { class: 'check-summary' }, ['尚未运行']);

  function run(): void {
    const results: CheckResult[] = runSelfCheck(store.state);
    const failed = results.filter((r) => !r.pass);
    summary.className = `check-summary ${failed.length ? 'fail' : 'pass'}`;
    summary.textContent = failed.length
      ? `${failed.length} 项超过 5% 误差阈值`
      : `${results.length} 项全部通过：公式、画面包络与 Allard 反解一致（≤5%）`;
    list.innerHTML = '';
    for (const r of results) {
      list.append(h('div', { class: `check-item ${r.pass ? 'pass' : 'fail'}` }, [
        h('div', { class: 'check-head' }, [
          h('strong', {}, [r.label]),
          h('span', { class: 'check-error' }, [`误差 ${r.errorPct.toFixed(3)}%`])
        ]),
        h('div', { class: 'check-values' }, [
          h('span', {}, [`模型：${r.expected}`]),
          h('span', {}, [`采样：${r.measured}`])
        ])
      ]));
    }
  }

  const el = h('section', { class: 'card control-card selfcheck-card' }, [
    h('h3', {}, ['精度自检']),
    h('p', { class: 'control-hint' }, ['直接对 WebGPU 同源的 beamResponse 包络加密采样，并把 Allard 射程代回公式。']),
    h('div', { class: 'button-row' }, [
      h('button', { class: 'btn primary', type: 'button', onClick: run }, ['重新运行自检'])
    ]),
    summary,
    list
  ]);
  run();
  return el;
}
