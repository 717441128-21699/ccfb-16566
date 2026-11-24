import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox','--enable-unsafe-webgpu','--enable-webgpu-developer-features','--ignore-gpu-blocklist','--window-size=1680,1050'],
  defaultViewport: { width: 1680, height: 1050 }
});
const page = await browser.newPage();
page.on('console', m => { if (m.type()==='error') console.log(m.text()); });
await page.goto('http://127.0.0.1:4317/#/exterior', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,2500));
await page.screenshot({path:'artifacts/debug-default.png'});
const checks = await page.$$('input[type=checkbox]');
console.log('checkboxes', checks.length);
// 取消“米氏雾体积光”（第二个复选框）
await checks[1].click();
await new Promise(r=>setTimeout(r,800));
await page.screenshot({path:'artifacts/debug-no-volume.png'});
// 再取消核心光束（第一个）
await checks[0].click();
await new Promise(r=>setTimeout(r,800));
await page.screenshot({path:'artifacts/debug-no-beams.png'});
await browser.close();
