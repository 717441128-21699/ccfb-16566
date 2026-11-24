import {
  beamDivergence,
  fogHaloHalfAngleRad,
  getFlashTiming,
  volumeBeamReachM
} from '../physics';
import { getWebGPUDevice } from './device';
import { exhibitShaderWGSL } from './shaders';
import type { ExhibitState } from '../state';

export type RenderMode = 'exterior' | 'section' | 'optics' | 'ship';

export interface RendererStats {
  fps: number;
  frameMs: number;
  width: number;
  height: number;
  scale: number;
  backend: 'WebGPU';
}

export interface BenchmarkResult {
  fps: number;
  avgFrameMs: number;
  frames: number;
  width: number;
  height: number;
  pass60: boolean;
  samples: number[];
}

const MODE_NUMBER: Record<RenderMode, number> = {
  exterior: 0,
  section: 1,
  optics: 2,
  ship: 3
};

export class LighthouseRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly mode: RenderMode;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private bindGroup!: GPUBindGroup;
  private uniformBuffer!: GPUBuffer;
  private observer: () => ExhibitState;
  private onStats?: (stats: RendererStats) => void;
  private onFrame?: (simTime: number, wallTime: number) => void;
  private resizeObserver?: ResizeObserver;
  private raf = 0;
  private destroyed = false;
  private wallTime = 0;
  private simTime = 0;
  private lastNow = 0;
  private frameEmaMs = 16.7;
  private scale = 0.82;
  private frameCount = 0;
  private lastStatsAt = 0;
  private adaptCooldown = 0;
  private benchmarking = false;

  private constructor(
    canvas: HTMLCanvasElement,
    mode: RenderMode,
    observer: () => ExhibitState,
    onStats?: (stats: RendererStats) => void,
    onFrame?: (simTime: number, wallTime: number) => void
  ) {
    this.canvas = canvas;
    this.mode = mode;
    this.observer = observer;
    this.onStats = onStats;
    this.onFrame = onFrame;
  }

  static async create(
    canvas: HTMLCanvasElement,
    mode: RenderMode,
    observer: () => ExhibitState,
    onStats?: (stats: RendererStats) => void,
    onFrame?: (simTime: number, wallTime: number) => void
  ): Promise<LighthouseRenderer | null> {
    const r = new LighthouseRenderer(canvas, mode, observer, onStats, onFrame);
    const ok = await r.init();
    return ok ? r : null;
  }

  private async init(): Promise<boolean> {
    const device = await getWebGPUDevice();
    if (!device) return false;
    this.device = device;
    const context = this.canvas.getContext('webgpu');
    if (!context) return false;
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    const module = device.createShaderModule({
      label: `lighthouse-${this.mode}`,
      code: exhibitShaderWGSL
    });
    const info = await module.getCompilationInfo();
    for (const message of info.messages) {
      const text = `WGSL ${message.type} line ${message.lineNum}:${message.linePos} ${message.message}`;
      if (message.type === 'error') console.error(text);
      else console.warn(text);
    }

    const layout = device.createBindGroupLayout({
      label: 'uniform-layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      }]
    });

    try {
      this.pipeline = await device.createRenderPipelineAsync({
        label: `pipeline-${this.mode}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' }
      });
    } catch (err) {
      console.error('WebGPU pipeline creation failed', err);
      return false;
    }

    this.uniformBuffer = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });

    this.applyQualityInitialScale();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.lastNow = performance.now();
    this.lastStatsAt = this.lastNow;
    this.raf = requestAnimationFrame(this.frame);
    return true;
  }

  private applyQualityInitialScale(): void {
    const q = this.observer().render.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (q === 'native') this.scale = dpr;
    else if (q === 'performance') this.scale = 0.62 * dpr;
    else this.scale = Math.min(1, 0.82 * dpr);
  }

  refreshQuality(): void {
    this.applyQualityInitialScale();
    this.resize();
  }

  private resize(forceWidth?: number, forceHeight?: number): void {
    if (forceWidth && forceHeight) {
      this.canvas.width = forceWidth;
      this.canvas.height = forceHeight;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, this.canvas.clientWidth || rect.width || 800);
    const cssH = Math.max(1, this.canvas.clientHeight || rect.height || 500);
    const q = this.observer().render.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = this.scale;
    if (q === 'native') scale = dpr;
    if (q === 'performance') scale = Math.min(this.scale, 0.68 * dpr);
    const maxW = q === 'native' ? 7680 : 5120;
    const maxH = q === 'native' ? 4320 : 2880;
    this.canvas.width = Math.min(maxW, Math.max(1, Math.round(cssW * scale)));
    this.canvas.height = Math.min(maxH, Math.max(1, Math.round(cssH * scale)));
  }

  /** 真的分配 3840×2160 后跑一段，用来在当前显卡上验证 4K 帧时间。 */
  async benchmark4K(frames = 180): Promise<BenchmarkResult | null> {
    if (this.destroyed) return null;
    this.benchmarking = true;
    this.resize(3840, 2160);
    const samples: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        if (n > 8) samples.push(dt); // 跳过预热。
        n++;
        if (n >= frames) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    this.benchmarking = false;
    this.resize();
    if (!samples.length) return null;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const fps = 1000 / avg;
    return {
      fps,
      avgFrameMs: avg,
      frames: samples.length,
      width: 3840,
      height: 2160,
      pass60: fps >= 59.0,
      samples
    };
  }

  private writeUniforms(): void {
    const s = this.observer();
    const timing = getFlashTiming(s);
    const halfAngle = beamDivergence(s.focalLengthM, s.sourceDiameterM) / 2;
    const sigma = 2.996 / Math.max(0.02, s.visibilityKm) / 1000;
    const reach = volumeBeamReachM(s);
    const intensity01 = Math.min(1, Math.max(0,
      (Math.log10(Math.max(1e4, s.intensityCd)) - 4) /
      (Math.log10(2_400_000) - 4)
    ));
    const halo = fogHaloHalfAngleRad(s.visibilityKm);
    const bearing = s.observer.bearingDeg * Math.PI / 180;
    const zoomTan = Math.tan((s.observer.zoomDeg * Math.PI / 180) / 2);
    const data = new Float32Array(32);

    data.set([this.canvas.width, this.canvas.height, this.wallTime, this.simTime], 0);
    data.set([s.panelCount, s.focalLengthM, s.sourceDiameterM, s.rpm], 4);
    data.set([halfAngle, timing.divergenceRad, timing.angularSpeedRadS, timing.angularSpeedRadS * this.simTime], 8);
    data.set([sigma, reach, intensity01, halo], 12);
    data.set([s.observer.distanceKm * 1000, bearing, s.observer.eyeHeightM, zoomTan], 16);
    data.set([s.lightColor[0], s.lightColor[1], s.lightColor[2], s.lanternHeightM], 20);
    data.set([
      MODE_NUMBER[this.mode],
      s.render.showVolume ? 1 : 0,
      s.render.showCoreBeams ? 1 : 0,
      s.render.showRays ? 1 : 0
    ], 24);
    data.set([
      s.render.showTir ? 1 : 0,
      this.scale,
      this.benchmarking ? 1 : 0,
      0
    ], 28);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data.buffer);
  }

  private frame = (now: number): void => {
    if (this.destroyed) return;
    const rawDt = Math.min(0.05, (now - this.lastNow) / 1000 || 0.016);
    this.lastNow = now;
    this.wallTime += rawDt;
    const state = this.observer();
    if (!state.observer.paused) {
      this.simTime += rawDt * state.observer.timeScale;
    }
    this.onFrame?.(this.simTime, this.wallTime);

    if (!this.benchmarking) {
      const q = state.render.quality;
      if (q === 'adaptive') {
        this.frameEmaMs = this.frameEmaMs * 0.94 + rawDt * 1000 * 0.06;
        this.adaptCooldown -= 1;
        if (this.adaptCooldown <= 0 && this.frameCount > 90) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          if (this.frameEmaMs > 17.2 && this.scale > 0.48 * dpr) {
            this.scale = Math.max(0.45 * dpr, this.scale - 0.08 * dpr);
            this.resize();
            this.adaptCooldown = 90;
          } else if (this.frameEmaMs < 12.5 && this.scale < 0.95 * dpr) {
            this.scale = Math.min(0.95 * dpr, this.scale + 0.04 * dpr);
            this.resize();
            this.adaptCooldown = 120;
          }
        }
      }
    }

    this.writeUniforms();
    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.01, g: 0.02, b: 0.04, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.frameCount++;
    if (now - this.lastStatsAt > 500 && this.onStats && !this.benchmarking) {
      const fps = Math.min(144, 1000 / this.frameEmaMs);
      this.onStats({
        fps: Math.round(fps),
        frameMs: this.frameEmaMs,
        width: this.canvas.width,
        height: this.canvas.height,
        scale: this.scale,
        backend: 'WebGPU'
      });
      this.lastStatsAt = now;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.uniformBuffer?.destroy();
    try { this.context?.unconfigure(); } catch { /* noop */ }
  }
}
