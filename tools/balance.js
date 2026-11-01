#!/usr/bin/env node
/* Headless balance simulator: bots play the real engine.
 *   node tools/balance.js                 -> summary matrix
 *   node tools/balance.js detail normal mixed   -> per-wave table for one run
 */
'use strict';
const D = require('../src/data.js');
const { Game } = require('../src/engine.js');
const { TOWERS } = D;
// optional tuning overrides for sweeps: HPG=<growth> HPA=<base> GB=<gold slope>
if (process.env.HPG || process.env.HPA) {
  const g = +(process.env.HPG || 1.105), a = +(process.env.HPA || 100), lin = +(process.env.HPL || 12);
  D.CFG.hpBudget = (w) => a * Math.pow(g, w - 1) + lin * w;
}
if (process.env.GB) { const b = +process.env.GB; D.CFG.goldBudget = (w) => 52 + b * w; }

const COLS = +(process.env.COLS || 10), ROWS = +(process.env.ROWS || 14); // default portrait

// ---- bot strategies: build weights + branch preference ------------------
const STRATS = {
  mixed:   { mix: ['arrow', 'frost', 'poison', 'cannon', 'storm', 'arrow', 'poison', 'cannon', 'frost', 'storm'], br: { arrow: 'a', cannon: 'a', frost: 'b', poison: 'b', storm: 'a', flak: 'b' }, aa: true },
  mixedB:  { mix: ['cannon', 'frost', 'poison', 'arrow', 'storm', 'cannon', 'poison', 'frost', 'storm', 'arrow'], br: { arrow: 'b', cannon: 'b', frost: 'a', poison: 'a', storm: 'b', flak: 'a' }, aa: true },
  arrow:   { mix: ['arrow'], br: { arrow: 'b' }, aa: false },
  cannon:  { mix: ['cannon'], br: { cannon: 'a' }, aa: false },
  cannonAA:{ mix: ['cannon'], br: { cannon: 'b' }, aa: true },
  frost:   { mix: ['frost'], br: { frost: 'a' }, aa: false },
  poison:  { mix: ['poison'], br: { poison: 'b' }, aa: false },
  storm:   { mix: ['storm'], br: { storm: 'a' }, aa: false },
  noaa:    { mix: ['arrow', 'frost', 'poison', 'cannon', 'storm'], br: { arrow: 'a', cannon: 'a', frost: 'b', poison: 'b', storm: 'a' }, aa: false },
  lazy:    { mix: ['arrow', 'frost', 'poison', 'cannon', 'storm'], br: { arrow: 'a', cannon: 'a', frost: 'b', poison: 'b', storm: 'a' }, aa: true, upgradeOnly: false, handicap: 0.7 },
};

function coverage(g, cx, cy, range, pathCells) {
  let n = 0;
  for (const p of pathCells) {
    const dx = p.x - cx, dy = p.y - cy;
    if (dx * dx + dy * dy <= range * range) n++;
  }
  return n;
}

function tryBuild(g, key) {
  const cost = TOWERS[key].levels[0].cost;
  if (g.gold < cost) return false;
  const path = g.pathCells();
  const range = TOWERS[key].levels[0].range + 0.4;
  const cand = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (g.grid[g.idx(x, y)] || g.isPoint(x, y)) continue;
    if (path.some((p) => p.x === x && p.y === y)) continue; // don't build on the lane (keeps maze intact)
    const cov = coverage(g, x + 0.5, y + 0.5, range, path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })));
    cand.push({ x, y, cov });
  }
  cand.sort((a, b) => b.cov - a.cov);
  for (const c of cand.slice(0, 12)) {
    const r = g.build(key, c.x, c.y);
    if (r.ok) return true;
  }
  return false;
}

function bestUpgrade(g, st) {
  // cheapest upgrade among towers, prefer lower level to spread power (but branches when affordable)
  let best = null;
  for (const t of g.towers) {
    const opts = g.upgradeInfo(t);
    if (!opts.length) continue;
    let o = opts[0];
    if (t.level === 3) o = opts.find((x) => x.branch === (st.br[t.key] || 'a'));
    const score = t.level * 1000 + o.stats.cost;
    if (!best || score < best.score) best = { t, o, score };
  }
  return best;
}

function act(g, st, st2) {
  // anti-air insurance
  if (st.aa) {
    const upcoming = g.wave + 1;
    const k = (upcoming - 1) % 10;
    const tier = Math.floor((upcoming - 1) / 10);
    const need = (k >= 3 && k <= 4) || k === 8 || (upcoming + 1) % 10 === 5 ? 1 + tier : 0;
    const flaks = g.towers.filter((t) => t.key === 'flak').length;
    const hasAny = g.wave >= 2;
    if (hasAny && flaks < Math.max(need, 1 + tier) && g.gold >= TOWERS.flak.levels[0].cost) {
      if (tryBuild(g, 'flak')) return true;
    }
  }
  const target = 5 + g.wave * 0.55;
  const aaN = g.towers.filter((t) => t.key === 'flak').length;
  if (g.towers.length - aaN < target) {
    const key = st.mix[st2.buildN % st.mix.length];
    if (g.gold >= TOWERS[key].levels[0].cost) {
      if (tryBuild(g, key)) { st2.buildN++; return true; }
    }
    return false;
  }
  const up = bestUpgrade(g, st);
  if (up && g.gold >= up.o.stats.cost) { g.upgrade(up.t, up.o.branch); return true; }
  if (!up) { // everything maxed: add towers
    const key = st.mix[st2.buildN % st.mix.length];
    if (g.gold >= TOWERS[key].levels[0].cost && tryBuild(g, key)) { st2.buildN++; return true; }
  }
  return false;
}

function run(diff, stratName, opts = {}) {
  const st = STRATS[stratName];
  const g = new Game({ cols: COLS, rows: ROWS, diff, seed: opts.seed || 7, fx: false });
  const st2 = { buildN: 0 };
  const log = [];
  let lastLives = g.lives, lastWave = 0, lastGoldSpent = 0, waveStartGold = g.gold;
  const dt = 1 / 30;
  let acc = 0, steps = 0;
  const calls = opts.early ? true : false;
  const lag = st.handicap ? 1 / st.handicap : 1;
  while (g.state === 'play' && g.time < 4000) {
    acc += dt;
    if (acc >= 0.4 * lag) { acc = 0; let n = 0; while (n++ < 6 && act(g, st, st2)); }
    if (calls && !g.enemies.length && !g.queue.length && g.nextTimer > 3 && isFinite(g.nextTimer)) g.callNext();
    g.update(dt);
    if (g.wave !== lastWave) {
      if (lastWave > 0) log[lastWave - 1].goldAtNext = g.gold;
      log.push({ wave: g.wave, livesAtStart: g.lives, goldAtStart: g.gold, towers: g.towers.length, spent: g.spent });
      lastWave = g.wave;
    }
    if (g.lives !== lastLives) {
      if (log.length) log[log.length - 1].lost = (log[log.length - 1].lost || 0) + (lastLives - g.lives);
      lastLives = g.lives;
    }
  }
  return { g, log };
}

function summary(diff, strat, opts) {
  const { g, log } = run(diff, strat, opts);
  const lost = log.filter((l) => l.lost).map((l) => `w${l.wave}:-${l.lost}`).join(' ');
  return { diff, strat, state: g.state, wave: g.wave, lives: g.lives, spent: g.spent, towers: g.towers.length, kills: g.kills, lost, g, log };
}

const mode = process.argv[2];
if (mode === 'detail') {
  const diff = process.argv[3] || 'normal', strat = process.argv[4] || 'mixed';
  const { g, log } = run(diff, strat, { early: process.argv[5] === 'early' });
  console.log(`state=${g.state} wave=${g.wave} lives=${g.lives} gold=${Math.floor(g.gold)} spent=${g.spent} towers=${g.towers.length} pathLen=${g.pathLen}`);
  console.log('LEAKS ' + (log.filter((l) => l.lost).map((l) => `w${l.wave}:-${l.lost}`).join(' ') || 'none'));
  console.log('wave | gold@start | towers | totalSpent | livesLost | HPbudget | goldBudget');
  for (const l of log) {
    console.log(`${String(l.wave).padStart(3)} | ${String(Math.floor(l.goldAtStart)).padStart(6)} | ${String(l.towers).padStart(4)} | ${String(l.spent).padStart(8)} | ${String(l.lost || 0).padStart(3)} | ${Math.round(D.CFG.hpBudget(l.wave)).toString().padStart(7)} | ${Math.round(D.CFG.goldBudget(l.wave))}`);
  }
} else if (mode !== 'margin') {
  const early = process.argv[2] === 'early';
  const diffs = ['easy', 'normal', 'hard'];
  const strats = Object.keys(STRATS);
  console.log(`bot results (${early ? 'calls waves early' : 'waits for timer'}); W = wave reached, L = lives left`);
  console.log('strategy'.padEnd(10) + diffs.map((d) => d.padEnd(34)).join(''));
  for (const s of strats) {
    let line = s.padEnd(10);
    for (const d of diffs) {
      const r = summary(d, s, { early });
      const cell = `${r.state === 'won' ? 'WIN' : r.state === 'lost' ? 'LOSS' : '??'} W${r.wave} L${r.lives} T${r.towers} $${r.spent}`;
      line += cell.padEnd(34);
    }
    console.log(line);
  }
}

// ---- "margin" mode: bisect the global HP multiplier at which the bot first loses ------
if (mode === 'margin') {
  const base = D.CFG.hpBudget;
  const early = process.argv[3] === 'early';
  const strats = (process.argv[4] ? process.argv[4].split(',') : ['mixed', 'mixedB', 'arrow', 'frost', 'poison', 'storm', 'noaa']);
  const diffs = ['easy', 'normal', 'hard'];
  console.log('breaking HP multiplier (bot still wins at x, loses above). 1.00 = current tuning');
  console.log('strategy'.padEnd(10) + diffs.map((d) => d.padEnd(10)).join(''));
  for (const s of strats) {
    let line = s.padEnd(10);
    for (const d of diffs) {
      let lo = 0.2, hi = 12;
      for (let i = 0; i < 12; i++) {
        const mid = Math.sqrt(lo * hi);
        D.CFG.hpBudget = (w) => base(w) * mid;
        const r = summary(d, s, { early });
        if (r.state === 'won') lo = mid; else hi = mid;
      }
      line += lo.toFixed(2).padEnd(10);
    }
    console.log(line);
  }
}
