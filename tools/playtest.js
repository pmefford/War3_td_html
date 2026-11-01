// Headless smoke test + screenshots. Usage: node tools/playtest.js [outdir]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const [name, vp, touch] of [['phone', { width: 390, height: 780 }, true], ['desktop', { width: 1280, height: 760 }, false]]) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
    await p.goto('file://' + path.resolve(__dirname, '../index.html'));
    await p.screenshot({ path: `${out}/${name}-menu.png` });
    await p.click('#btnPlay');
    await p.waitForTimeout(300);
    // place towers via the engine through the real UI: select build + click cells
    const info = await p.evaluate(() => { const g = window.__td.game; const r = document.getElementById('cv').getBoundingClientRect(); return { cols: g.cols, rows: g.rows, w: r.width, h: r.height, l: r.left, t: r.top }; });
    const cell = Math.floor(Math.min(info.w / info.cols, info.h / info.rows));
    const ox = (info.w - cell * info.cols) / 2, oy = (info.h - cell * info.rows) / 2;
    const at = (x, y) => [info.l + ox + (x + 0.5) * cell, info.t + oy + (y + 0.5) * cell];
    const spots = name === 'phone' ? [[2, 1], [4, 2], [6, 3], [3, 5]] : [[3, 1], [6, 2], [9, 1], [5, 5]];
    const keys = ['arrow', 'frost', 'poison', 'cannon'];
    for (let i = 0; i < spots.length; i++) {
      await p.click(`.bt[data-key="${keys[i]}"]`);
      const [x, y] = at(...spots[i]);
      if (touch) { await p.touchscreen.tap(x, y); await p.touchscreen.tap(x, y); } else await p.mouse.click(x, y);
    }
    const n = await p.evaluate(() => window.__td.game.towers.length);
    console.log(name, 'towers placed:', n);
    await p.click('#btnNext');
    await p.waitForTimeout(6000);
    await p.screenshot({ path: `${out}/${name}-play.png` });
    // select a tower
    const [sx, sy] = at(...spots[0]);
    if (touch) await p.touchscreen.tap(sx, sy); else await p.mouse.click(sx, sy);
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/${name}-sel.png` });
    await ctx.close();
  }
  console.log('errors:', errors.length ? errors : 'none');
  await b.close();
})();
