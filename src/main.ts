import './style.css';
import { h } from './ui/components';
import { webgpuSupported } from './webgpu/device';
import { runSelfCheck } from './selfcheck';
import { store, type PageId } from './state';
import { renderExteriorPage } from './pages/exterior';
import { renderSectionPage } from './pages/section';
import { renderOpticsPage } from './pages/optics';
import { renderObserverPage } from './pages/observer';
import type { PageHandle } from './pages/types';

const NAV: Array<{ id: PageId; label: string; icon: string; desc: string }> = [
  { id: 'exterior', label: '灯塔外景', icon: '🗼', desc: '旋转光束与海雾体积光' },
  { id: 'section', label: '透镜剖面', icon: '◉', desc: '面板、折射环与 TIR 棱镜' },
  { id: 'optics', label: '光路讲解', icon: '╱╲', desc: 'Snell、全反射与米氏散射' },
  { id: 'observer', label: '观察点设置', icon: '🚢', desc: '船视角、闪光周期与射程' }
];

function pageFromHash(): PageId {
  const hash = location.hash.replace('#/', '').replace('#', '') as PageId;
  return NAV.some((n) => n.id === hash) ? hash : 'exterior';
}

function renderPage(id: PageId): PageHandle {
  if (id === 'section') return renderSectionPage();
  if (id === 'optics') return renderOpticsPage();
  if (id === 'observer') return renderObserverPage();
  return renderExteriorPage();
}

function boot(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app not found');

  const checks = runSelfCheck(store.state);
  const passed = checks.filter((c) => c.pass).length;
  const gpuOk = webgpuSupported();

  const nav = h('nav', { class: 'main-nav', 'aria-label': '展项页面导航' },
    NAV.map((item) => h('a', {
      class: 'nav-item',
      href: `#/${item.id}`,
      dataset: { route: item.id },
      onClick: (e: Event) => {
        e.preventDefault();
        location.hash = `/${item.id}`;
      }
    }, [
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, [item.icon]),
      h('span', { class: 'nav-text' }, [
        h('strong', {}, [item.label]),
        h('small', {}, [item.desc])
      ])
    ]))
  );

  const header = h('header', { class: 'app-header' }, [
    h('div', { class: 'brand' }, [
      h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, ['✦']),
      h('div', {}, [
        h('h1', {}, ['菲涅尔灯塔光学数字展']),
        h('p', {}, ['Fresnel panels · Allard range · Mie fog shafts · WebGPU'])
      ])
    ]),
    h('div', { class: 'header-badges' }, [
      h('span', { class: `badge ${passed === checks.length ? 'good' : 'bad'}` }, [
        `精度自检 ${passed}/${checks.length} ≤5%`
      ]),
      h('span', { class: `badge ${gpuOk ? 'good' : 'warn'}` }, [
        gpuOk ? 'WebGPU API 可用' : '未检测到 WebGPU'
      ])
    ]),
    nav
  ]);

  const main = h('main', { class: 'app-main' }, []);
  const footer = h('footer', { class: 'app-footer' }, [
    h('span', {}, ['四座灯塔及灯质均为教学虚构；公式阈值取夜间固定灯光 0.2 μlx。']),
    h('span', {}, ['Chrome/Edge 113+ 推荐 · 4K 性能测试位于“观察点设置”'])
  ]);
  app.append(header, main, footer);

  let current: PageHandle | null = null;
  function route(): void {
    const id = pageFromHash();
    current?.destroy?.();
    main.innerHTML = '';
    current = renderPage(id);
    main.append(current.el);
    for (const a of header.querySelectorAll<HTMLElement>('.nav-item')) {
      a.classList.toggle('active', a.dataset.route === id);
      a.setAttribute('aria-current', a.dataset.route === id ? 'page' : 'false');
    }
    window.scrollTo({ top: 0 });
  }

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '/exterior';
  route();
}

boot();
