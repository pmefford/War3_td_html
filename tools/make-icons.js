// Renders icons/icon.svg to the PNG sizes needed for install (uses the preinstalled Playwright/Chromium).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../icons/icon.svg'), 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  async function shot(size, out, pad) {
    await p.setViewportSize({ width: size, height: size });
    const inner = pad ? Math.round(size * (1 - 2 * pad)) : size;
    await p.setContent(`<body style="margin:0;background:${pad ? '#10151f' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
    await p.screenshot({ path: path.join(__dirname, '../icons', out), omitBackground: !pad });
  }
  await shot(192, 'icon-192.png'); await shot(512, 'icon-512.png'); await shot(180, 'apple-touch-icon.png');
  await shot(512, 'icon-maskable-512.png', 0.1);
  await b.close();
})();
