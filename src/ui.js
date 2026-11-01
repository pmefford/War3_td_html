/* Bastion TD - UI, rendering, input, audio. */
(function () {
  'use strict';
  const D = window.TDData, { Game } = window.TDEngine;
  const { CFG, TOWERS, TOWER_ORDER, ENEMIES } = D;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');

  const ENEMY_ICON = { grunt: '👹', runner: '🐺', swarm: '🐜', tank: '🛡️', mage: '🔮', flyer: '🐉', boss: '👑' };
  const MODE_LABEL = { first: 'First', last: 'Last', strong: 'Strongest', close: 'Closest' };

  // ------------------------------------------------------------ persistence
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bastiontd.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bastiontd.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ------------------------------------------------------------ state
  let game = null, diffKey = store.get('diff', 'normal');
  let build = null, selTower = null, ghost = null, sellArm = 0;
  let speed = 1, paused = false, muted = store.get('muted', false);
  let cell = 32, ox = 0, oy = 0, W = 0, H = 0, dpr = 1;
  let effects = [], pathCache = null, pathDirty = true, lastUiSig = '', lastSelSig = '', endShown = false;
  let toastTimer = 0, bannerTimer = 0;

  // ------------------------------------------------------------ audio (tiny synth, no assets)
  let ac = null; const lastSfx = {};
  function sfx(name) {
    if (muted) return;
    try {
      if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ac = new AC(); }
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime, t = performance.now();
      const S = {
        shot: [520, 0.04, 'square', 0.015, 300], kill: [660, 0.06, 'triangle', 0.04, 990], build: [300, 0.12, 'triangle', 0.08, 500],
        upgrade: [440, 0.22, 'triangle', 0.09, 880], sell: [500, 0.15, 'triangle', 0.07, 250], leak: [160, 0.3, 'sawtooth', 0.1, 70],
        wave: [220, 0.35, 'sawtooth', 0.07, 330], clear: [523, 0.3, 'triangle', 0.08, 784], win: [523, 0.7, 'triangle', 0.1, 1046], lose: [200, 0.8, 'sawtooth', 0.1, 50],
      }[name];
      if (!S) return;
      const gap = name === 'shot' ? 70 : name === 'kill' ? 45 : 0;
      if (gap && t - (lastSfx[name] || 0) < gap) return;
      lastSfx[name] = t;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = S[2]; o.frequency.setValueAtTime(S[0], now); o.frequency.exponentialRampToValueAtTime(S[4], now + S[1]);
      g.gain.setValueAtTime(S[3], now); g.gain.exponentialRampToValueAtTime(0.0001, now + S[1]);
      o.connect(g).connect(ac.destination); o.start(now); o.stop(now + S[1] + 0.02);
    } catch (e) { /* audio is optional */ }
  }

  // ------------------------------------------------------------ small helpers
  function toast(msg, bad) {
    const el = $('toast'); el.textContent = msg; el.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, 1500);
  }
  function banner(html, ms) {
    const el = $('banner'); el.innerHTML = html; el.classList.add('on');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('on'), ms || 1800);
  }
  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n)));
  const tag = (cls, txt) => `<span class="tag ${cls}">${txt}</span>`;

  function waveSummary(w) {
    return D.waveGroups(w).map((g) => {
      const E = ENEMIES[g.t];
      let tags = '';
      if (E.air) tags += tag('air', 'AIR');
      if (E.armor0 >= 5) tags += tag('arm', 'ARMOR');
      if (E.mres > 0.3) tags += tag('mag', 'WARDED');
      if (E.boss) tags += tag('boss', 'BOSS');
      return `${ENEMY_ICON[g.t]} <b>${E.name}</b> ×${g.n}${tags}`;
    }).join(' &nbsp;+&nbsp; ');
  }

  // ------------------------------------------------------------ layout / new game
  function measure() {
    const r = $('stage').getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (game) {
      cell = Math.max(10, Math.floor(Math.min(W / game.cols, H / game.rows)));
      ox = Math.floor((W - cell * game.cols) / 2); oy = Math.floor((H - cell * game.rows) / 2);
    }
  }
  function newGame() {
    const r = $('stage').getBoundingClientRect();
    const landscape = r.width > r.height * 1.15;
    game = new Game({ cols: landscape ? 16 : 10, rows: landscape ? 10 : 14, diff: diffKey, seed: (Math.random() * 1e9) | 0 });
    build = null; selTower = null; ghost = null; effects = []; pathDirty = true; endShown = false; paused = false;
    speed = 1; $('btnSpeed').textContent = '1×'; $('pausedTag').hidden = true; $('btnPause').textContent = '⏸';
    lastUiSig = ''; lastSelSig = '';
    measure(); buildDock();
    $('menu').hidden = true; $('end').hidden = true;
    banner(`Get ready<small>${CFG.difficulties[diffKey].name} · place towers, then send wave 1</small>`, 2400);
  }

  // ------------------------------------------------------------ dock (tower buttons / selected tower)
  function buildDock() {
    const el = $('build'); el.innerHTML = '';
    TOWER_ORDER.forEach((k, i) => {
      const T = TOWERS[k], b = document.createElement('button');
      b.className = 'bt'; b.dataset.key = k; b.title = `${T.name} [${i + 1}]`;
      b.innerHTML = `<span class="ic">${T.icon}</span><span class="nm">${T.name.replace(' Tower', '')}</span><span class="co">${T.levels[0].cost}</span>`;
      b.onclick = () => selectBuild(build === k ? null : k);
      el.appendChild(b);
    });
  }
  function selectBuild(k) {
    build = k; selTower = null; ghost = null; sellArm = 0; lastSelSig = '';
    refreshUi(true);
  }
  function selectTower(t) {
    selTower = t; build = null; ghost = null; sellArm = 0; lastSelSig = '';
    refreshUi(true);
  }
  function statLine(s) {
    const dps = Math.round(D.dpsOf(s));
    let x = `<span>DMG <b>${s.dmg}</b>${s.multi ? '×' + s.multi : ''}</span><span>Rate <b>${s.rate.toFixed(1)}/s</b></span><span>Range <b>${s.range}</b></span><span>DPS <b>~${dps}</b></span>`;
    if (s.splash) x += `<span>Splash <b>${s.splash}</b></span>`;
    if (s.chain) x += `<span>Chain <b>${s.chain.n}</b></span>`;
    if (s.slow) x += `<span>Slow <b>${Math.round(s.slow[0] * 100)}%</b></span>`;
    if (s.poison) x += `<span>Poison <b>${s.poison.dps}/s ×${s.poison.max}</b></span>`;
    x += `<span>${s.dtype === 'magic' ? '✨ Magic' : '⚔️ Physical'} · ${s.targets === 'air' ? 'Air only' : s.targets === 'ground' ? 'Ground only' : 'Ground+Air'}</span>`;
    return x;
  }
  function renderSel() {
    const t = selTower, el = $('sel');
    if (!t) { el.hidden = true; return; }
    const T = TOWERS[t.key], g = game;
    const sig = [t.id, t.level, t.branch, t.mode, sellArm > 0, g.gold >= 1e9 ? 0 : g.upgradeInfo(t).map((o) => g.gold >= o.stats.cost).join(',')].join('|');
    if (sig === lastSelSig) return; lastSelSig = sig;
    const opts = g.upgradeInfo(t);
    let acts = '';
    if (!opts.length) acts += `<button disabled>Max level</button>`;
    else if (opts.length === 1) {
      const o = opts[0].stats;
      acts += `<button class="primary up" data-act="up" data-br="" ${g.gold < o.cost ? 'disabled' : ''}>⬆ ${o.name} · ${o.cost}🪙<small>DMG ${o.dmg} · ${o.rate.toFixed(1)}/s · rng ${o.range}</small></button>`;
    } else {
      for (const op of opts) {
        const o = op.stats;
        acts += `<button class="primary up" data-act="up" data-br="${op.branch}" ${g.gold < o.cost ? 'disabled' : ''}>★ ${o.name} · ${o.cost}🪙<small>${o.desc}</small></button>`;
      }
    }
    acts += `<button class="sell ${sellArm > 0 ? 'confirm' : ''}" data-act="sell">${sellArm > 0 ? 'Confirm sell' : 'Sell'} +${g.sellValue(t)}🪙</button>`;
    el.innerHTML = `<div class="top"><span class="ic">${T.icon}</span><div><div class="nm">${t.s.name}</div>
      <div class="lv">Lv ${t.level}${t.level >= 4 ? ' (final)' : ''} · ${t.kills} kills</div></div>
      <button class="x" data-act="close">✕</button></div>
      <div class="stats">${statLine(t.s)}</div>
      <div class="acts">${acts}</div>
      <div class="acts"><button data-act="mode">🎯 Target: ${MODE_LABEL[t.mode]}</button></div>`;
    el.hidden = false;
  }
  $('sel').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !selTower) return;
    const act = b.dataset.act, t = selTower;
    if (act === 'close') selectTower(null);
    else if (act === 'mode') { game.cycleMode(t); lastSelSig = ''; renderSel(); }
    else if (act === 'up') {
      const r = game.upgrade(t, b.dataset.br || null);
      if (!r.ok) toast(r.reason, true); else { sfx('upgrade'); lastSelSig = ''; }
      refreshUi(true);
    } else if (act === 'sell') {
      if (sellArm > 0) { game.sell(t); sfx('sell'); pathDirty = true; selectTower(null); }
      else { sellArm = 1; lastSelSig = ''; renderSel(); setTimeout(() => { if (sellArm) { sellArm = 0; lastSelSig = ''; renderSel(); } }, 2500); }
    }
  });

  // ------------------------------------------------------------ HUD refresh (~10 Hz)
  function refreshUi(force) {
    if (!game) return;
    const g = game;
    $('stLives').querySelector('b').textContent = g.lives;
    $('stGold').querySelector('b').textContent = fmt(g.gold);
    $('stWave').querySelector('b').textContent = g.endless ? `${g.wave}` : `${g.wave}/${g.maxWave}`;
    // next button
    const btn = $('btnNext'), info = $('nextInfo');
    const nw = g.wave + 1, canCall = !g.queue.length && isFinite(g.nextTimer) && g.state === 'play' && (g.endless || g.wave < g.maxWave);
    if (canCall) {
      const bonus = g.wave === 0 ? 0 : Math.floor(g.nextTimer * CFG.earlyCallRate * (1 + g.wave * 0.04));
      btn.disabled = false;
      btn.innerHTML = `▶ Send wave ${nw}${bonus > 0 ? ` <small>+${bonus}🪙</small>` : ''}`;
      info.innerHTML = `Next in <b>${Math.ceil(g.nextTimer)}s</b> · ${waveSummary(nw)}`;
    } else {
      btn.disabled = true;
      btn.textContent = g.queue.length ? `Wave ${g.wave} incoming…` : (g.wave >= g.maxWave && !g.endless ? 'Final wave!' : '…');
      const left = g.enemies.length + g.queue.length;
      info.innerHTML = g.wave >= g.maxWave && !g.endless ? `Destroy the last <b>${left}</b> enemies` : `<b>${left}</b> enemies left · ${waveSummary(g.wave)}`;
    }
    // build button states
    for (const b of $('build').children) {
      const k = b.dataset.key, poor = g.gold < TOWERS[k].levels[0].cost;
      b.classList.toggle('poor', poor); b.classList.toggle('sel', build === k);
    }
    $('hint').innerHTML = build
      ? `<b>${TOWERS[build].name}</b> — ${TOWERS[build].blurb} ${matchMedia('(pointer:coarse)').matches ? 'Tap a tile, tap again to build.' : 'Click a tile to build.'}`
      : (selTower ? '' : 'Pick a tower, then tap the grid. Tap a tower to upgrade it.');
    $('build').hidden = !!selTower; $('hint').hidden = !!selTower;
    renderSel();
  }

  // ------------------------------------------------------------ input
  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left - ox) / cell), y = Math.floor((ev.clientY - r.top - oy) / cell);
    return game && game.inb(x, y) ? { x, y } : null;
  }
  function tryPlace(c) {
    const r = game.build(build, c.x, c.y);
    if (!r.ok) { toast(r.reason, true); return; }
    sfx('build'); pathDirty = true; ghost = null;
    if (game.gold < TOWERS[build].levels[0].cost) toast('Out of gold – tower placed');
  }
  cv.addEventListener('pointerdown', (ev) => {
    if (!game || game.state !== 'play') return;
    ev.preventDefault();
    const c = cellAt(ev);
    if (!c) { if (build) { ghost = null; } else selectTower(null); return; }
    const t = game.grid[game.idx(c.x, c.y)];
    if (t) { selectTower(t === selTower ? null : t); return; }
    if (build) {
      const mouse = ev.pointerType === 'mouse';
      if (mouse || (ghost && ghost.x === c.x && ghost.y === c.y)) tryPlace(c);
      else { ghost = { x: c.x, y: c.y }; const chk = game.canBuild(c.x, c.y); ghost.ok = chk.ok; if (!chk.ok) toast(chk.reason, true); }
      refreshUi(true);
    } else if (selTower) selectTower(null);
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!game || ev.pointerType !== 'mouse') return;
    const c = cellAt(ev);
    if (build && c) { if (!ghost || ghost.x !== c.x || ghost.y !== c.y) { ghost = { x: c.x, y: c.y, ok: game.canBuild(c.x, c.y).ok }; } }
    else if (!c) ghost = null;
  });
  cv.addEventListener('pointerleave', () => { if (ghost && !('ontouchstart' in window)) ghost = null; });

  function callNext() {
    if (!game) return;
    const b = game.callNext();
    if (b > 0) toast(`Early send bonus +${b}🪙`);
  }
  $('btnNext').onclick = callNext;
  $('btnPause').onclick = () => setPause(!paused);
  function setPause(p) { paused = p; $('pausedTag').hidden = !p; $('btnPause').textContent = p ? '▶' : '⏸'; }
  $('btnSpeed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; $('btnSpeed').textContent = speed + '×'; };
  $('btnSound').textContent = muted ? '🔇' : '🔊';
  $('btnSound').onclick = () => { muted = !muted; store.set('muted', muted); $('btnSound').textContent = muted ? '🔇' : '🔊'; };
  $('btnMenu').onclick = () => { setPause(true); showMenu(true); };
  window.addEventListener('keydown', (e) => {
    if (!game || !$('menu').hidden || !$('end').hidden) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '6') selectBuild(build === TOWER_ORDER[+k - 1] ? null : TOWER_ORDER[+k - 1]);
    else if (k === ' ') { e.preventDefault(); callNext(); }
    else if (k === 'p') setPause(!paused);
    else if (k === 'escape') { build = null; selectTower(null); }
    else if (k === 'u' && selTower) { const o = game.upgradeInfo(selTower); if (o.length === 1) { const r = game.upgrade(selTower); if (r.ok) sfx('upgrade'); else toast(r.reason, true); lastSelSig = ''; } }
    else if (k === 's' && selTower) { game.sell(selTower); sfx('sell'); pathDirty = true; selectTower(null); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.state === 'play') setPause(true); });
  window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe($('stage'));
  window.addEventListener('orientationchange', () => setTimeout(measure, 200));

  // ------------------------------------------------------------ menu / end screens
  function renderMenu() {
    const el = $('diffs'); el.innerHTML = '';
    for (const k of Object.keys(CFG.difficulties)) {
      const d = CFG.difficulties[k], b = document.createElement('button');
      b.className = k === diffKey ? 'on' : '';
      b.innerHTML = `<b>${d.name}</b><small>${d.lives} lives · ${d.gold}🪙</small>`;
      b.onclick = () => { diffKey = k; store.set('diff', k); renderMenu(); };
      el.appendChild(b);
    }
    const best = store.get('best', {});
    $('bestLine').textContent = Object.keys(best).length
      ? 'Best: ' + Object.keys(CFG.difficulties).filter((k) => best[k]).map((k) => `${CFG.difficulties[k].name} ${best[k].score} (wave ${best[k].wave})`).join(' · ')
      : 'Tip: add this page to your home screen for the app icon.';
  }
  function showMenu(inGame) {
    renderMenu();
    $('btnResume').hidden = !(inGame && game && game.state === 'play');
    $('btnPlay').textContent = inGame ? 'New game' : 'Play';
    $('menu').hidden = false;
  }
  $('btnPlay').onclick = () => { newGame(); };
  $('btnResume').onclick = () => { $('menu').hidden = true; setPause(false); };
  $('btnHow').onclick = () => { $('how').hidden = !$('how').hidden; };
  $('btnRetry').onclick = () => newGame();
  $('btnToMenu').onclick = () => { $('end').hidden = true; showMenu(false); };
  $('btnEndarless').onclick = () => { game.continueEndless(); endShown = false; $('end').hidden = true; };

  function showEnd() {
    endShown = true;
    const g = game, won = g.state === 'won', score = g.score();
    const best = store.get('best', {}), prev = best[g.diffKey];
    const isBest = !prev || score > prev.score;
    if (isBest) { best[g.diffKey] = { score, wave: g.wave }; store.set('best', best); }
    $('endTitle').textContent = won ? '🏆 Victory!' : '💀 Defeated';
    $('endSub').innerHTML = `${CFG.difficulties[g.diffKey].name} · reached wave <b>${g.wave}</b>${g.endless ? ' (endless)' : ''}<br>Score <b>${score}</b>${isBest ? ' — new best!' : ''}<br>${g.kills} kills · ${g.lives} lives left · ${fmt(g.spent)}🪙 spent`;
    $('btnEndarless').hidden = !won;
    $('end').hidden = false;
    sfx(won ? 'win' : 'lose');
  }

  // ------------------------------------------------------------ effects from engine
  function drainFx() {
    for (const f of game.fx) {
      switch (f.k) {
        case 'beam': effects.push({ k: 'beam', pts: f.pts, color: f.color, ttl: 0.16, max: 0.16 }); break;
        case 'boom': effects.push({ k: 'boom', x: f.x, y: f.y, r: f.r, color: f.color, ttl: 0.28, max: 0.28 }); break;
        case 'kill': if (effects.length < 90) effects.push({ k: 'txt', x: f.x, y: f.y, text: '+' + f.gold, color: f.boss ? '#ffd24a' : '#e9d98a', ttl: f.boss ? 1.2 : 0.7, max: f.boss ? 1.2 : 0.7 }); sfx('kill'); break;
        case 'shot': sfx('shot'); break;
        case 'leak': sfx('leak'); { const el = $('stLives'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } break;
        case 'wave': {
          const w = f.w, boss = D.waveGroups(w).some((g) => g.t === 'boss');
          banner(`${boss ? '👑 ' : ''}Wave ${w}<small>${waveSummary(w).replace(/<[^>]+>/g, '')}</small>`, 1800); sfx('wave'); break;
        }
        case 'clear': toast(`Wave ${f.w} cleared  +${f.bonus}🪙`); sfx('clear'); break;
        case 'upgrade': effects.push({ k: 'boom', x: f.x + 0.5, y: f.y + 0.5, r: 0.9, color: '#ffe27a', ttl: 0.35, max: 0.35 }); break;
        default: break;
      }
    }
    game.fx.length = 0;
  }

  // ------------------------------------------------------------ rendering
  const C = (c, a) => c; // colour passthrough (kept for readability)
  function px(x) { return ox + x * cell; }
  function py(y) { return oy + y * cell; }

  function drawBoard() {
    const g = game;
    ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#1b2432' : '#18202d';
      ctx.fillRect(px(x), py(y), cell, cell);
    }
    // route (cached)
    if (pathDirty) { pathCache = g.pathCells(); pathDirty = false; }
    if (pathCache && pathCache.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(242,180,65,.28)'; ctx.lineWidth = Math.max(2, cell * 0.14); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash([cell * 0.2, cell * 0.28]); ctx.beginPath();
      pathCache.forEach((p, i) => { const X = px(p.x + 0.5), Y = py(p.y + 0.5); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke(); ctx.restore();
    }
    // waypoints
    const labels = ['S', '1', '2', 'E'], cols = ['#3fae6a', '#4a8fd8', '#4a8fd8', '#d85a5a'];
    g.points.forEach((p, i) => {
      const cx = px(p.x + 0.5), cy = py(p.y + 0.5);
      ctx.fillStyle = cols[i]; ctx.globalAlpha = 0.28; ctx.fillRect(px(p.x), py(p.y), cell, cell); ctx.globalAlpha = 1;
      ctx.strokeStyle = cols[i]; ctx.lineWidth = 2; ctx.strokeRect(px(p.x) + 2, py(p.y) + 2, cell - 4, cell - 4);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.floor(cell * 0.45)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], cx, cy + 1);
    });
  }
  function ring(x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(px(x), py(y), r * cell, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function drawTower(t) {
    const T = TOWERS[t.key], x = px(t.x), y = py(t.y), m = Math.max(1, cell * 0.06);
    ctx.fillStyle = '#273146'; roundRect(x + m, y + m, cell - 2 * m, cell - 2 * m, cell * 0.16); ctx.fill();
    ctx.strokeStyle = t.level >= 4 ? '#ffd24a' : T.color; ctx.lineWidth = t.level >= 4 ? 3 : 2; roundRect(x + m, y + m, cell - 2 * m, cell - 2 * m, cell * 0.16); ctx.stroke();
    ctx.font = `${Math.floor(cell * 0.5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.fillText(T.icon, x + cell / 2, y + cell * 0.47);
    // aim nub
    const ax = x + cell / 2 + Math.cos(t.angle) * cell * 0.36, ay = y + cell / 2 + Math.sin(t.angle) * cell * 0.36;
    ctx.fillStyle = T.color; ctx.beginPath(); ctx.arc(ax, ay, cell * 0.07, 0, 7); ctx.fill();
    // pips
    const n = Math.min(t.level, 3);
    for (let i = 0; i < n; i++) { ctx.fillStyle = '#f2b441'; ctx.beginPath(); ctx.arc(x + cell * (0.5 + (i - (n - 1) / 2) * 0.17), y + cell * 0.88, cell * 0.05, 0, 7); ctx.fill(); }
    if (t.level >= 4) { ctx.fillStyle = '#ffd24a'; ctx.font = `${Math.floor(cell * 0.28)}px system-ui`; ctx.fillText('★', x + cell * 0.82, y + cell * 0.2); }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawEnemy(e) {
    const X = px(e.x), Y = py(e.y), r = e.E.r * cell;
    const flash = e.hit > 0;
    if (e.air) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(X + r * 0.5, Y + r * 1.1, r, r * 0.45, 0, 0, 7); ctx.fill(); }
    ctx.save(); ctx.translate(X, e.air ? Y - r * 0.5 : Y);
    ctx.fillStyle = flash ? '#fff' : e.E.color; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 2;
    switch (e.type) {
      case 'runner': ctx.rotate(e.ang || 0); ctx.beginPath(); ctx.moveTo(r * 1.15, 0); ctx.lineTo(-r, r * 0.9); ctx.lineTo(-r * 0.5, 0); ctx.lineTo(-r, -r * 0.9); ctx.closePath(); break;
      case 'tank': roundRect(-r, -r, r * 2, r * 2, r * 0.3); break;
      case 'mage': ctx.beginPath(); ctx.moveTo(0, -r * 1.2); ctx.lineTo(r, 0); ctx.lineTo(0, r * 1.2); ctx.lineTo(-r, 0); ctx.closePath(); break;
      case 'flyer': ctx.rotate(e.ang || 0); ctx.beginPath(); ctx.moveTo(r * 1.2, 0); ctx.lineTo(-r * 0.6, r * 1.3); ctx.lineTo(-r * 0.2, 0); ctx.lineTo(-r * 0.6, -r * 1.3); ctx.closePath(); break;
      default: ctx.beginPath(); ctx.arc(0, 0, r, 0, 7);
    }
    ctx.fill(); ctx.stroke();
    if (e.boss) { ctx.fillStyle = '#ffd24a'; ctx.font = `${Math.floor(r * 1.3)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♛', 0, 1); }
    if (e.type === 'tank') { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.strokeRect(-r * 0.5, -r * 0.5, r, r); }
    ctx.restore();
    const cy = e.air ? Y - r * 0.5 : Y;
    if (e.slowT > 0) { ctx.strokeStyle = 'rgba(127,208,238,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, cy, r + 3, 0, 7); ctx.stroke(); }
    if (e.poison.length) { ctx.fillStyle = 'rgba(143,207,74,.85)'; ctx.beginPath(); ctx.arc(X - r * 0.6, cy - r * 1.05, 2.5, 0, 7); ctx.fill(); }
    if (e.stun > 0) { ctx.fillStyle = '#ffe66b'; ctx.fillText('✦', X, cy - r - 8); }
    if (e.ampT > 0) { ctx.strokeStyle = 'rgba(255,120,120,.9)'; ctx.beginPath(); ctx.arc(X, cy, r + 5, 0, 7); ctx.stroke(); }
    if (e.hp < e.maxHp) {
      const w = Math.max(14, r * 2.2), hx = X - w / 2, hy = cy - r - 7;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(hx - 1, hy - 1, w + 2, 5);
      const f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = f > 0.5 ? '#5fd38d' : f > 0.25 ? '#f2b441' : '#ef5d5d'; ctx.fillRect(hx, hy, w * f, 3);
    }
  }
  function drawRange(cx, cy, range, ok) {
    ctx.beginPath(); ctx.arc(px(cx), py(cy), range * cell, 0, Math.PI * 2);
    ctx.fillStyle = ok ? 'rgba(255,255,255,.07)' : 'rgba(239,93,93,.1)'; ctx.fill();
    ctx.strokeStyle = ok ? 'rgba(255,255,255,.4)' : 'rgba(239,93,93,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game) { ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, W, H); return; }
    const g = game;
    drawBoard();
    if (selTower) drawRange(selTower.x + 0.5, selTower.y + 0.5, selTower.s.range, true);
    if (selTower) { ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.strokeRect(px(selTower.x) + 1, py(selTower.y) + 1, cell - 2, cell - 2); }
    for (const t of g.towers) drawTower(t);
    if (build && ghost) {
      const T = TOWERS[build], ok = ghost.ok && g.gold >= T.levels[0].cost;
      drawRange(ghost.x + 0.5, ghost.y + 0.5, T.levels[0].range, ok);
      ctx.globalAlpha = 0.7; ctx.fillStyle = ok ? 'rgba(95,211,141,.35)' : 'rgba(239,93,93,.4)'; ctx.fillRect(px(ghost.x), py(ghost.y), cell, cell);
      ctx.font = `${Math.floor(cell * 0.5)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(T.icon, px(ghost.x + 0.5), py(ghost.y + 0.5)); ctx.globalAlpha = 1;
    }
    // ground first, then air
    for (const e of g.enemies) if (!e.air) drawEnemy(e);
    for (const p of g.projs) {
      const T = TOWERS[p.t.key];
      ctx.fillStyle = T.color; ctx.beginPath(); ctx.arc(px(p.x), py(p.y), Math.max(2, cell * (p.s.splash ? 0.1 : 0.06)), 0, 7); ctx.fill();
    }
    for (const e of g.enemies) if (e.air) drawEnemy(e);
    for (const f of effects) {
      const a = Math.max(0, f.ttl / f.max);
      if (f.k === 'beam') {
        ctx.strokeStyle = f.color; ctx.globalAlpha = a; ctx.lineWidth = 3; ctx.beginPath();
        f.pts.forEach((p, i) => { const X = px(p.x), Y = py(p.y); i ? ctx.lineTo(X + (Math.random() - 0.5) * 4, Y + (Math.random() - 0.5) * 4) : ctx.moveTo(X, Y); });
        ctx.stroke(); ctx.globalAlpha = 1;
      } else if (f.k === 'boom') {
        const rr = f.r * (1 - a * 0.4); ctx.globalAlpha = a * 0.55; ctx.fillStyle = f.color; ring(f.x, f.y, rr, f.color); ctx.globalAlpha = a; ring(f.x, f.y, f.r, null, f.color); ctx.globalAlpha = 1;
      } else if (f.k === 'txt') {
        ctx.globalAlpha = Math.min(1, a * 1.5); ctx.fillStyle = f.color; ctx.font = `bold ${Math.floor(cell * 0.32)}px system-ui`; ctx.textAlign = 'center';
        ctx.fillText(f.text, px(f.x), py(f.y) - (1 - a) * cell * 0.7); ctx.globalAlpha = 1;
      }
    }
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now(), acc = 0, uiClock = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (game && !paused && $('menu').hidden) {
      acc += dt * speed;
      let n = 0;
      while (acc >= STEP && n++ < 12) { game.update(STEP); acc -= STEP; }
      if (acc > STEP * 12) acc = 0;
      for (const f of effects) f.ttl -= dt * speed;
      effects = effects.filter((f) => f.ttl > 0);
    }
    if (game) {
      drainFx();
      if (game.state !== 'play' && !endShown) showEnd();
    }
    uiClock += dt;
    if (uiClock > 0.1) { uiClock = 0; if (game) refreshUi(); }
    render();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ boot
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
  }
  // debug/test hook
  window.__td = { get game() { return game; }, newGame, selectBuild };
  measure(); showMenu(false);
  requestAnimationFrame(frame);
})();
