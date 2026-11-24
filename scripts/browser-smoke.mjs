import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173/';
mkdirSync('artifacts', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-webgpu-developer-features',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--window-size=1680,1050'
  ],
  defaultViewport: { width: 1680, height: 1050, deviceScaleFactor: 1 }
});

const page = await browser.newPage();
const logs = [];
page.on('console', (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.stack || err.message}`));

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 3500));

const gpu = await page.evaluate(async () => {
  if (!navigator.gpu) return { api: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return {
      api: true,
      adapter: !!adapter,
      info: adapter?.info ? {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description
      } : null
    };
  } catch (e) {
    return { api: true, error: String(e) };
  }
});
console.log('GPU', JSON.stringify(gpu));

const routes = [
  ['exterior', '#/exterior', 'artifacts/01-exterior.png'],
  ['section', '#/section', 'artifacts/02-section.png'],
  ['optics', '#/optics', 'artifacts/03-optics.png'],
  ['observer', '#/observer', 'artifacts/04-observer.png']
];

for (const [name, hash, shot] of routes) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await new Promise((r) => setTimeout(r, 2600));
  await page.screenshot({ path: shot, fullPage: false });
  const stats = await page.evaluate(() => document.querySelector('.render-stats')?.textContent?.trim() || '');
  const fallbackVisible = await page.evaluate(() => {
    const el = document.querySelector('.webgpu-fallback');
    return el ? !el.hasAttribute('hidden') : false;
  });
  console.log(`ROUTE ${name}: stats="${stats}" fallback=${fallbackVisible} shot=${shot}`);
}

// 打开观察点页并运行一次较短的真 4K 压测路径（产品按钮固定 180 帧；这里只检查方法不抛错）。
const benchmark = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('3840'));
  if (!btn) return { started: false, reason: 'button missing' };
  btn.click();
  await new Promise((r) => setTimeout(r, 1200));
  return { started: true, text: document.querySelector('.benchmark-output')?.textContent?.trim() || '' };
});
console.log('BENCH', JSON.stringify(benchmark));
await new Promise((r) => setTimeout(r, 5000));
console.log('BENCH_RESULT', await page.evaluate(() => document.querySelector('.benchmark-output')?.textContent?.trim() || ''));

await browser.close();

const problems = logs.filter((line) =>
  /\[pageerror\]|console\.error|WGSL .*error|Pipeline .*failed|WebGPU pipeline/i.test(line)
);
if (logs.length) console.log('\n--- browser logs ---\n' + logs.join('\n'));
if (problems.length) {
  console.error('\nSmoke test found browser/shader errors.');
  process.exit(1);
}
console.log('\nBrowser smoke test passed without page or WGSL errors.');
