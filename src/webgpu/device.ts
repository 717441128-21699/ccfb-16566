let devicePromise: Promise<GPUDevice | null> | null = null;

export async function getWebGPUDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance'
      });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      device.lost.then((info) => {
        console.warn('WebGPU device lost:', info.reason, info.message);
      });
      return device;
    } catch (err) {
      console.warn('WebGPU initialization failed:', err);
      return null;
    }
  })();
  return devicePromise;
}

export function webgpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
