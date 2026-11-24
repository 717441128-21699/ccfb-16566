import {
  LIGHTHOUSE_PRESETS,
  type LighthousePreset
} from './physics';

export type PageId = 'exterior' | 'section' | 'optics' | 'observer';
export type QualityMode = 'adaptive' | 'performance' | 'native';

export interface ObserverSettings {
  /** 船到灯塔水平距离，km。 */
  distanceKm: number;
  /** 船相对灯塔光束零位的方位角，deg。 */
  bearingDeg: number;
  eyeHeightM: number;
  zoomDeg: number;
  paused: boolean;
  timeScale: number;
}

export interface RenderSettings {
  quality: QualityMode;
  showVolume: boolean;
  showCoreBeams: boolean;
  showRays: boolean;
  showTir: boolean;
  showLabels: boolean;
  rayBounce: number;
}

export interface ExhibitState extends LighthousePreset {
  presetId: string;
  observer: ObserverSettings;
  render: RenderSettings;
}

type Listener = (state: ExhibitState, changed?: Partial<ExhibitState>) => void;

const defaultPreset = LIGHTHOUSE_PRESETS[0];

export function createInitialState(): ExhibitState {
  return {
    ...structuredClone(defaultPreset),
    presetId: defaultPreset.id,
    observer: {
      distanceKm: 8,
      bearingDeg: 0,
      eyeHeightM: 5,
      zoomDeg: 7.5,
      paused: false,
      timeScale: 1
    },
    render: {
      quality: 'adaptive',
      showVolume: true,
      showCoreBeams: true,
      showRays: true,
      showTir: true,
      showLabels: true,
      rayBounce: 1
    }
  };
}

class Store {
  state: ExhibitState = createInitialState();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(patch: Partial<ExhibitState>): void {
    this.state = { ...this.state, ...patch };
    this.emit(patch);
  }

  updateObserver(patch: Partial<ObserverSettings>): void {
    this.state = {
      ...this.state,
      observer: { ...this.state.observer, ...patch }
    };
    this.emit();
  }

  updateRender(patch: Partial<RenderSettings>): void {
    this.state = {
      ...this.state,
      render: { ...this.state.render, ...patch }
    };
    this.emit();
  }

  applyPreset(id: string): void {
    const preset = LIGHTHOUSE_PRESETS.find((p) => p.id === id) ?? LIGHTHOUSE_PRESETS[0];
    this.state = {
      ...this.state,
      ...structuredClone(preset),
      presetId: preset.id,
      // 保留观察点与渲染质量偏好。
      observer: this.state.observer,
      render: this.state.render
    };
    this.emit({ presetId: id });
  }

  private emit(changed?: Partial<ExhibitState>): void {
    for (const fn of this.listeners) fn(this.state, changed);
  }
}

export const store = new Store();
