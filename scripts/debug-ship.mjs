import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--window-size=1680,1050'],
  defaultViewport: { width: 1680, height: 1050 }
});
const page = await browser.newPage();
await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:4317/#/observer', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,2200));
await page.evaluate(() => {
  const ranges = document.querySelectorAll('input[type=range]');
  const set = (i,v) => { ranges[i].value=String(v); ranges[i].dispatchEvent(new Event('input',{bubbles:true})); };
  set(0, 3.2); // distance
  set(3, 24);  // zoom
});
await new Promise(r=>setTimeout(r,300));
const aligned = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('对准当前面板'));
  btn?.click();
  return !!btn;
});
console.log('align button', aligned);
await new Promise(r=>setTimeout(r,180));
await page.screenshot({ path: 'artifacts/debug-ship-aligned.png' });
await browser.close();
