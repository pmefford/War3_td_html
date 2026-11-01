/* Bastion TD - simulation engine. No DOM; runs in the browser and in Node (balance sim). */
(function () {
  'use strict';
  const D = (typeof module === 'object' && module.exports) ? require('./data.js') : window.TDData;
  const { CFG, ENEMIES, TOWERS } = D;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const TARGET_MODES = ['first', 'last', 'strong', 'close'];

  class Game {
    constructor(o) {
      this.cols = o.cols; this.rows = o.rows;
      this.diffKey = o.diff || 'normal';
      this.diff = CFG.difficulties[this.diffKey];
      this.rand = mulberry32(o.seed || 1);
      this.fxOn = o.fx !== false;
      this.fx = [];
      const c = this.cols, r = this.rows;
      // spawn -> checkpoint 1 -> checkpoint 2 -> exit (forces a long zig-zag route)
      this.points = [
        { x: 0, y: 0 },
        { x: c - 1, y: Math.floor(r / 3) },
        { x: 0, y: Math.floor((2 * r) / 3) },
        { x: c - 1, y: r - 1 },
      ];
      this.grid = new Array(c * r).fill(null);
      this.towers = []; this.enemies = []; this.projs = [];
      this.gold = this.diff.gold; this.lives = this.diff.lives;
      this.wave = 0; this.maxWave = CFG.maxWave; this.endless = false;
      this.time = 0; this.nextTimer = CFG.startCountdown;
      this.queue = []; this.waveInfo = {};
      this.kills = 0; this.leaks = 0; this.spent = 0;
      this.state = 'play'; // play | won | lost
      this.nextId = 1;
      this.fields = this.computeFields(-1);
      this.updateLegRest();
    }

    idx(x, y) { return y * this.cols + x; }
    inb(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
    isPoint(x, y) { return this.points.some((p) => p.x === x && p.y === y); }

    // --------------------------------------------------------- path fields
    computeFields(extraBlock) {
      const c = this.cols, n = this.cols * this.rows, out = [];
      for (let l = 0; l < 3; l++) {
        const f = new Int16Array(n).fill(-1);
        const t = this.points[l + 1];
        const q = [this.idx(t.x, t.y)]; f[q[0]] = 0;
        for (let h = 0; h < q.length; h++) {
          const cur = q[h], cx = cur % c, cy = (cur / c) | 0;
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (!this.inb(nx, ny)) continue;
            const ni = this.idx(nx, ny);
            if (f[ni] >= 0 || this.grid[ni] || ni === extraBlock) continue;
            f[ni] = f[cur] + 1; q.push(ni);
          }
        }
        out.push(f);
      }
      return out;
    }
    fieldsValid(fields) {
      for (let l = 0; l < 3; l++) {
        const s = this.points[l];
        if (fields[l][this.idx(s.x, s.y)] < 0) return false;
      }
      for (const e of this.enemies) {
        if (e.air || !e.alive) continue;
        if (fields[e.leg][this.idx(e.nx, e.ny)] < 0) return false;
      }
      return true;
    }
    updateLegRest() {
      const f = this.fields, p = this.points;
      this.legLen = [0, 1, 2].map((l) => f[l][this.idx(p[l].x, p[l].y)]);
      this.legRest = [this.legLen[1] + this.legLen[2], this.legLen[2], 0];
      this.pathLen = this.legLen[0] + this.legLen[1] + this.legLen[2];
    }
    /** Cells currently walked by ground enemies (spawn to exit). */
    pathCells() {
      const out = [];
      let x = this.points[0].x, y = this.points[0].y;
      for (let leg = 0; leg < 3; leg++) {
        const f = this.fields[leg], tgt = this.points[leg + 1];
        let guard = 500;
        while (guard-- > 0) {
          out.push({ x, y });
          if (x === tgt.x && y === tgt.y) break;
          const nx = this.nextCell(leg, x, y);
          if (!nx) break;
          x = nx.x; y = nx.y;
        }
      }
      return out;
    }
    nextCell(leg, x, y) {
      const f = this.fields[leg];
      let best = null, bv = 1e9;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        const v = f[this.idx(nx, ny)];
        if (v >= 0 && v < bv) { bv = v; best = { x: nx, y: ny }; }
      }
      const cur = f[this.idx(x, y)];
      if (best && (cur < 0 || bv < cur)) return best;
      return null;
    }

    // --------------------------------------------------------- building
    canBuild(cx, cy) {
      if (!this.inb(cx, cy)) return { ok: false, reason: 'Out of bounds' };
      if (this.grid[this.idx(cx, cy)]) return { ok: false, reason: 'Occupied' };
      if (this.isPoint(cx, cy)) return { ok: false, reason: 'Reserved tile' };
      for (const e of this.enemies) {
        if (e.air || !e.alive) continue;
        if ((Math.floor(e.x) === cx && Math.floor(e.y) === cy) || (e.nx === cx && e.ny === cy)) {
          return { ok: false, reason: 'Enemy in the way' };
        }
      }
      const f = this.computeFields(this.idx(cx, cy));
      if (!this.fieldsValid(f)) return { ok: false, reason: "Can't block the path!" };
      return { ok: true };
    }
    build(key, cx, cy) {
      const cost = TOWERS[key].levels[0].cost;
      if (this.gold < cost) return { ok: false, reason: 'Not enough gold' };
      const chk = this.canBuild(cx, cy);
      if (!chk.ok) return chk;
      const t = {
        id: this.nextId++, key, x: cx, y: cy, level: 1, branch: null, cd: 0.2,
        invested: cost, mode: 'first', angle: 0, kills: 0,
      };
      t.s = D.statsFor(key, 1, null);
      this.towers.push(t); this.grid[this.idx(cx, cy)] = t;
      this.gold -= cost; this.spent += cost;
      this.fields = this.computeFields(-1); this.updateLegRest();
      this.emit({ k: 'build', x: cx, y: cy });
      return { ok: true, tower: t };
    }
    upgradeInfo(t) {
      const T = TOWERS[t.key];
      if (t.level < 3) return [{ branch: null, stats: D.statsFor(t.key, t.level + 1, null) }];
      if (t.level === 3) return ['a', 'b'].map((b) => ({ branch: b, stats: D.statsFor(t.key, 4, b) }));
      return [];
    }
    upgrade(t, branch) {
      const opts = this.upgradeInfo(t);
      const o = opts.find((x) => x.branch === (branch || null));
      if (!o) return { ok: false, reason: 'Max level' };
      if (this.gold < o.stats.cost) return { ok: false, reason: 'Not enough gold' };
      this.gold -= o.stats.cost; this.spent += o.stats.cost; t.invested += o.stats.cost;
      t.level++; t.branch = o.branch; t.s = o.stats;
      this.emit({ k: 'upgrade', x: t.x, y: t.y });
      return { ok: true };
    }
    sellValue(t) { return Math.floor(t.invested * CFG.sellRate); }
    sell(t) {
      this.gold += this.sellValue(t);
      this.grid[this.idx(t.x, t.y)] = null;
      this.towers.splice(this.towers.indexOf(t), 1);
      this.fields = this.computeFields(-1); this.updateLegRest();
      this.emit({ k: 'sell', x: t.x, y: t.y });
    }
    cycleMode(t) { t.mode = TARGET_MODES[(TARGET_MODES.indexOf(t.mode) + 1) % TARGET_MODES.length]; }

    // --------------------------------------------------------- waves
    nextWaveNumber() { return this.wave + 1; }
    callNext() {
      if (this.state !== 'play' || this.queue.length || !(this.nextTimer > 0) || !isFinite(this.nextTimer)) return 0;
      if (!this.endless && this.wave >= this.maxWave) return 0;
      const bonus = this.wave === 0 ? 0 : Math.floor(this.nextTimer * CFG.earlyCallRate * (1 + this.wave * 0.04));
      this.gold += bonus;
      this.startWave();
      return bonus;
    }
    startWave() {
      this.wave++;
      const w = this.wave;
      const groups = D.makeWave(w);
      let t = 0.2, total = 0;
      for (const g of groups) {
        for (let i = 0; i < g.n; i++) { this.queue.push({ at: t, g }); t += g.gap; total++; }
        t += 0.8;
      }
      this.queue.sort((a, b) => a.at - b.at);
      this.queueClock = 0;
      this.waveInfo[w] = { alive: total, spawned: false, cleared: false };
      this.nextTimer = Infinity;
      this.emit({ k: 'wave', w });
    }
    spawn(g) {
      const E = ENEMIES[g.t];
      const hp = g.hp * this.diff.hp;
      const e = {
        id: this.nextId++, type: g.t, E, hp, maxHp: hp, speed: E.speed,
        armor: g.armor, mres: E.mres, air: !!E.air, boss: !!E.boss,
        bounty: g.bounty * this.diff.bounty, wave: this.wave,
        x: this.points[0].x + 0.5, y: this.points[0].y + 0.5,
        leg: 0, nx: this.points[0].x, ny: this.points[0].y, alive: true,
        slowPct: 0, slowT: 0, stun: 0, poison: [], amp: 0, ampT: 0, ab: 0, abT: 0, hit: 0,
      };
      if (!e.air) { const nc = this.nextCell(0, e.nx, e.ny); if (nc) { e.nx = nc.x; e.ny = nc.y; } }
      this.enemies.push(e);
    }

    // --------------------------------------------------------- enemies
    emit(f) { if (this.fxOn) this.fx.push(f); }
    remaining(e) {
      if (e.air) {
        const p = this.points[3];
        return Math.hypot(p.x + 0.5 - e.x, p.y + 0.5 - e.y);
      }
      const v = this.fields[e.leg][this.idx(e.nx, e.ny)];
      return (v < 0 ? 999 : v) + Math.hypot(e.nx + 0.5 - e.x, e.ny + 0.5 - e.y) + this.legRest[e.leg];
    }
    moveEnemy(e, dt) {
      if (e.stun > 0) { e.stun -= dt; return; }
      let sp = e.speed * (e.slowT > 0 ? 1 - e.slowPct : 1);
      let step = sp * dt;
      if (e.air) {
        const p = this.points[3], tx = p.x + 0.5, ty = p.y + 0.5;
        const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
        if (d <= step) { this.leak(e); return; }
        e.x += (dx / d) * step; e.y += (dy / d) * step; e.ang = Math.atan2(dy, dx);
        return;
      }
      let guard = 8;
      while (step > 1e-9 && guard-- > 0) {
        const tx = e.nx + 0.5, ty = e.ny + 0.5, dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
        if (d > step) { e.x += (dx / d) * step; e.y += (dy / d) * step; e.ang = Math.atan2(dy, dx); return; }
        e.x = tx; e.y = ty; step -= d;
        const tp = this.points[e.leg + 1];
        if (e.nx === tp.x && e.ny === tp.y) {
          e.leg++;
          if (e.leg >= 3) { this.leak(e); return; }
        }
        const nc = this.nextCell(e.leg, e.nx, e.ny);
        if (!nc) return;
        e.nx = nc.x; e.ny = nc.y;
      }
    }
    leak(e) {
      if (!e.alive) return;
      e.alive = false; this.leaks++;
      this.lives -= e.boss ? CFG.bossLeakCost : 1;
      this.finishUnit(e);
      this.emit({ k: 'leak', boss: e.boss });
      if (this.lives <= 0) { this.lives = 0; this.state = 'lost'; }
    }
    finishUnit(e) {
      const wi = this.waveInfo[e.wave];
      if (wi) { wi.alive--; this.checkCleared(e.wave); }
    }
    checkCleared(w) {
      const wi = this.waveInfo[w];
      if (!wi || wi.cleared || !wi.spawned || wi.alive > 0) return;
      wi.cleared = true;
      const b = CFG.clearBonus(w);
      this.gold += b;
      this.emit({ k: 'clear', w, bonus: b });
    }
    kill(e, src) {
      if (!e.alive) return;
      e.alive = false; this.kills++;
      const g = Math.max(1, Math.round(e.bounty));
      this.gold += g;
      if (src) src.kills++;
      this.emit({ k: 'kill', x: e.x, y: e.y, gold: g, boss: e.boss, color: e.E.color });
      this.finishUnit(e);
    }
    damage(e, d, type, src) {
      if (!e.alive) return;
      if (e.ampT > 0) d *= 1 + e.amp;
      if (type === 'phys') {
        const a = Math.max(0, e.armor - (e.abT > 0 ? e.ab : 0));
        d *= 60 / (60 + a);
      } else if (type === 'magic') d *= 1 - e.mres;
      e.hp -= d; e.hit = 0.08;
      if (e.hp <= 0) this.kill(e, src);
    }
    applySlow(e, pct, dur) {
      if (e.boss) pct = Math.min(pct, 0.5);
      if (e.slowT <= 0 || pct > e.slowPct) { e.slowPct = pct; e.slowT = dur; }
      else if (pct === e.slowPct) e.slowT = Math.max(e.slowT, dur);
    }
    addPoison(e, p, m) {
      let dps = p.dps * m;
      if (p.pct) dps += Math.min(p.pct * e.maxHp, p.pctCap || 1e9) * m;
      const st = { dps, t: p.dur };
      if (e.poison.length >= p.max) {
        let wi = 0;
        for (let i = 1; i < e.poison.length; i++) if (e.poison[i].t < e.poison[wi].t) wi = i;
        e.poison[wi] = st;
      } else e.poison.push(st);
    }
    applyHit(t, s, e, m) {
      let d = s.dmg * m, crit = false;
      if (s.crit && this.rand() < s.crit.c) { d *= s.crit.m; crit = true; }
      this.damage(e, d, s.dtype, t);
      if (!e.alive) return;
      if (s.slow) this.applySlow(e, s.slow[0], s.slow[1]);
      if (s.amp) { e.amp = Math.max(e.ampT > 0 ? e.amp : 0, s.amp[0]); e.ampT = s.amp[1]; }
      if (s.shred) { e.ab = Math.max(e.abT > 0 ? e.ab : 0, s.shred.amt); e.abT = s.shred.dur; }
      if (s.poison) this.addPoison(e, s.poison, Math.max(m, 0.5));
      if (s.stun && !e.boss && this.rand() < s.stun.c) e.stun = Math.max(e.stun, s.stun.d);
      if (crit) this.emit({ k: 'crit', x: e.x, y: e.y });
    }
    eligible(s, e) { return e.alive && (s.targets === 'both' || (s.targets === 'air') === e.air); }

    // --------------------------------------------------------- towers
    pickTargets(t, n) {
      const s = t.s, cx = t.x + 0.5, cy = t.y + 0.5, r2 = s.range * s.range;
      const c = [];
      for (const e of this.enemies) {
        if (!this.eligible(s, e)) continue;
        const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        let key;
        switch (t.mode) {
          case 'last': key = -this.remaining(e); break;
          case 'strong': key = -e.hp; break;
          case 'close': key = d2; break;
          default: key = this.remaining(e);
        }
        c.push({ e, key });
      }
      if (!c.length) return [];
      c.sort((a, b) => a.key - b.key);
      return c.slice(0, n).map((x) => x.e);
    }
    fire(t) {
      const s = t.s;
      const targets = this.pickTargets(t, s.multi || 1);
      if (!targets.length) return false;
      const e0 = targets[0];
      t.angle = Math.atan2(e0.y - (t.y + 0.5), e0.x - (t.x + 0.5));
      if (s.chain) { this.lightning(t, e0); return true; }
      for (const e of targets) {
        this.projs.push({ x: t.x + 0.5, y: t.y + 0.5, tgt: e, tx: e.x, ty: e.y, spd: s.speed, t, s, dead: false });
      }
      this.emit({ k: 'shot', key: t.key });
      return true;
    }
    lightning(t, first) {
      const s = t.s, ch = s.chain, hit = new Set([first]), pts = [{ x: t.x + 0.5, y: t.y + 0.5 }];
      let cur = first, m = 1;
      for (let i = 0; i < ch.n && cur; i++) {
        pts.push({ x: cur.x, y: cur.y });
        this.applyHit(t, s, cur, m);
        m *= ch.fall;
        let nxt = null, bd = ch.r * ch.r;
        for (const e of this.enemies) {
          if (hit.has(e) || !this.eligible(s, e)) continue;
          const dx = e.x - cur.x, dy = e.y - cur.y, d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; nxt = e; }
        }
        if (nxt) hit.add(nxt);
        cur = nxt;
      }
      this.emit({ k: 'beam', pts, color: TOWERS[t.key].color });
      this.emit({ k: 'shot', key: t.key });
    }
    impact(p) {
      const s = p.s, t = p.t;
      if (s.splash) {
        for (const e of this.enemies) {
          if (!this.eligible(s, e)) continue;
          const d = Math.hypot(e.x - p.tx, e.y - p.ty);
          if (d <= s.splash) this.applyHit(t, s, e, 1 - 0.5 * (d / s.splash));
        }
        this.emit({ k: 'boom', x: p.tx, y: p.ty, r: s.splash, color: TOWERS[t.key].color });
      } else if (p.tgt.alive) {
        this.applyHit(t, s, p.tgt, 1);
        if (s.spread) {
          for (const e of this.enemies) {
            if (e === p.tgt || !this.eligible(s, e)) continue;
            if (Math.hypot(e.x - p.tx, e.y - p.ty) <= s.spread.r) this.addPoison(e, s.poison, s.spread.frac);
          }
          this.emit({ k: 'boom', x: p.tx, y: p.ty, r: s.spread.r, color: TOWERS[t.key].color });
        }
      }
    }

    // --------------------------------------------------------- main step
    update(dt) {
      if (this.state !== 'play') return;
      this.time += dt;
      // wave timer / spawning
      if (this.queue.length) {
        this.queueClock += dt;
        while (this.queue.length && this.queue[0].at <= this.queueClock) this.spawn(this.queue.shift().g);
        if (!this.queue.length) {
          this.waveInfo[this.wave].spawned = true;
          this.checkCleared(this.wave);
          if (this.endless || this.wave < this.maxWave) this.nextTimer = CFG.waveGap;
        }
      } else if (isFinite(this.nextTimer)) {
        this.nextTimer -= dt;
        if (this.nextTimer <= 0) this.startWave();
      }
      // enemies
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e.slowT > 0) e.slowT -= dt;
        if (e.ampT > 0) e.ampT -= dt;
        if (e.abT > 0) e.abT -= dt;
        if (e.hit > 0) e.hit -= dt;
        if (e.poison.length) {
          let dps = 0;
          for (const p of e.poison) { dps += p.dps; p.t -= dt; }
          e.poison = e.poison.filter((p) => p.t > 0);
          this.damage(e, dps * dt, 'magic', null);
        }
        if (e.alive) this.moveEnemy(e, dt);
      }
      // towers
      for (const t of this.towers) {
        t.cd -= dt;
        if (t.cd <= 0) {
          if (this.fire(t)) t.cd += 1 / t.s.rate;
          else t.cd = 0;
        }
      }
      // projectiles
      for (const p of this.projs) {
        if (p.tgt.alive) { p.tx = p.tgt.x; p.ty = p.tgt.y; }
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = p.spd * dt;
        if (d <= step || d < 0.05) { this.impact(p); p.dead = true; } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
      }
      this.projs = this.projs.filter((p) => !p.dead);
      this.enemies = this.enemies.filter((e) => e.alive);
      // victory
      if (this.state === 'play' && !this.endless && this.wave >= this.maxWave && !this.queue.length && !this.enemies.length) {
        this.state = 'won';
      }
    }
    continueEndless() {
      if (this.state !== 'won') return;
      this.endless = true; this.state = 'play'; this.nextTimer = CFG.waveGap;
    }
    score() {
      const w = this.state === 'won' || this.endless ? this.wave : Math.max(0, this.wave - 1);
      return Math.round(w * 100 + this.lives * 40 + this.kills * 2 + (this.state === 'won' ? 1000 : 0));
    }
  }

  const API = { Game, TARGET_MODES };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else window.TDEngine = API;
})();
