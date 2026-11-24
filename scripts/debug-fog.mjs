import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--window-size=1680,1050'],
  defaultViewport: { width: 1680, height: 1050 }
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4317/#/exterior', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,2200));
await page.evaluate(() => {
  const ranges = document.querySelectorAll('input[type=range]');
  const set = (input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(ranges[4], 0.8); // visibility km
  set(ranges[0], 8);    // panels
});
await new Promise(r=>setTimeout(r,1800));
await page.screenshot({ path: 'artifacts/debug-fog.png' });
await browser.close();
