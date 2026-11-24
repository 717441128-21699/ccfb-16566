import { LighthouseRenderer, type RenderMode, type RendererStats } from '../webgpu/renderer';
import { store } from '../state';
import { h } from './components';

export interface StageShell {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  setStats: (s: RendererStats) => void;
  setStatus: (text: string, tone?: string) => void;
  renderer: LighthouseRenderer | null;
  destroy: () => void;
}

export function createStageShell(
  title: string,
  subtitle: string,
  mode: RenderMode,
  onFrame?: (simTime: number, wallTime: number) => void
): StageShell {
  const canvas = h('canvas', { class: `webgpu-canvas mode-${mode}` }) as HTMLCanvasElement;
  const stats = h('div', { class: 'render-stats' }, ['WebGPU 初始化中…']);
  const status = h('div', { class: 'stage-status' }, ['']);
  const card = h('section', { class: 'card stage-card' }, [
    h('div', { class: 'stage-head' }, [
      h('div', {}, [
        h('h2', {}, [title]),
        h('p', { class: 'stage-subtitle' }, [subtitle])
      ]),
      stats
    ]),
    h('div', { class: 'canvas-wrap' }, [
      canvas,
      h('div', { class: 'canvas-corner-hud' }, [status]),
      h('div', { class: 'webgpu-fallback', hidden: true }, [
        h('h3', {}, ['当前浏览器没有可用 WebGPU']),
        h('p', {}, ['请使用最新版 Chrome/Edge，并在 chrome://gpu 确认 WebGPU/Hardware acceleration 已开启。'])
      ])
    ])
  ]);

  let disposed = false;
  const shell: StageShell = {
    card,
    canvas,
    stats,
    renderer: null,
    setStats(s) {
      stats.innerHTML = '';
      stats.append(
        h('span', { class: 'stat-pill good' }, [`${s.fps} FPS`]),
        h('span', { class: 'stat-pill' }, [`${s.width}×${s.height}`]),
        h('span', { class: 'stat-pill' }, [`${s.frameMs.toFixed(1)} ms`])
      );
    },
    setStatus(text, tone = '') {
      status.textContent = text;
      status.className = `stage-status ${tone}`;
    },
    destroy() {
      disposed = true;
      shell.renderer?.destroy();
    }
  };

  void LighthouseRenderer.create(canvas, mode, () => store.state, (s) => shell.setStats(s), onFrame)
    .then((renderer) => {
      if (!renderer) {
        const fallback = card.querySelector('.webgpu-fallback') as HTMLElement;
        fallback.hidden = false;
        stats.innerHTML = '<span class="stat-pill bad">WebGPU unavailable</span>';
        return;
      }
      if (disposed) {
        renderer.destroy();
        return;
      }
      shell.renderer = renderer;
    });

  return shell;
}
