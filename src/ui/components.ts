export type Child = Node | string | null | undefined | false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementProps<_T extends HTMLElement> = Record<string, any>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps<HTMLElementTagNameMap[K]> = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) el.dataset[dk] = dv;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key.startsWith('aria-') || key === 'role' || key === 'for') {
      el.setAttribute(key, String(value));
    } else if (key in el) {
      try {
        (el as unknown as Record<string, unknown>)[key] = value;
      } catch {
        el.setAttribute(key, String(value));
      }
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  onInput: (v: number) => void;
  hint?: string;
}

export function sliderRow(o: SliderOptions): HTMLLabelElement {
  const value = h('span', { class: 'control-value' }, [
    o.format ? o.format(o.value) : `${o.value}${o.unit ?? ''}`
  ]);
  const input = h('input', {
    type: 'range',
    min: String(o.min),
    max: String(o.max),
    step: String(o.step),
    value: String(o.value),
    'aria-label': o.label
  } as Partial<HTMLInputElement>) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = o.format ? o.format(v) : `${v}${o.unit ?? ''}`;
    o.onInput(v);
  });
  return h('label', { class: 'control-row' }, [
    h('span', { class: 'control-label' }, [o.label, value]),
    input,
    o.hint ? h('small', { class: 'control-hint' }, [o.hint]) : null
  ]) as HTMLLabelElement;
}

export function syncSlider(row: HTMLElement, value: number, format?: (v: number) => string): void {
  const input = row.querySelector('input') as HTMLInputElement | null;
  const out = row.querySelector('.control-value');
  if (input && document.activeElement !== input) input.value = String(value);
  if (out) out.textContent = format ? format(value) : String(value);
}

export function toggleRow(label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', checked } as Partial<HTMLInputElement>) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle-row' }, [
    input,
    h('span', {}, [label]),
    hint ? h('small', {}, [hint]) : null
  ]) as HTMLLabelElement;
}

export function statCard(label: string, value: string, sub = '', tone = ''): HTMLDivElement {
  return h('div', { class: `stat-card ${tone}` }, [
    h('div', { class: 'stat-label' }, [label]),
    h('div', { class: 'stat-value' }, [value]),
    sub ? h('div', { class: 'stat-sub' }, [sub]) : null
  ]);
}

export function formulaBox(title: string, formula: string, detail: string): HTMLElement {
  return h('div', { class: 'formula-box' }, [
    h('div', { class: 'formula-title' }, [title]),
    h('code', { class: 'formula' }, [formula]),
    h('p', {}, [detail])
  ]);
}

export function badge(text: string, tone = ''): HTMLSpanElement {
  return h('span', { class: `badge ${tone}` }, [text]);
}
