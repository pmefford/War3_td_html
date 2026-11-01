/* Bastion TD - game data: towers, enemies, waves, economy.
 * Pure data + tiny helpers. Shared by the browser game and the Node balance simulator. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  const CFG = {
    maxWave: 40,
    startCountdown: 25,   // seconds before wave 1
    waveGap: 14,          // seconds between end of spawning and next wave
    sellRate: 0.7,
    bossLeakCost: 5,
    // wave hit-point budget and gold budget (per wave, before difficulty)
    hpBudget: (w) => 330 * Math.pow(1.14, w - 1) + 12 * w,
    goldBudget: (w) => 52 + 8 * w,
    clearBonus: (w) => 6 + Math.floor(w * 1.2),
    earlyCallRate: 0.5,   // gold per remaining countdown second when calling a wave early
    difficulties: {
      easy:   { name: 'Easy',   lives: 30, gold: 260, hp: 0.80, bounty: 1.10 },
      normal: { name: 'Normal', lives: 20, gold: 220, hp: 1.00, bounty: 1.00 },
      hard:   { name: 'Hard',   lives: 12, gold: 215, hp: 1.25, bounty: 0.94 },
    },
  };

  // ---------------------------------------------------------------- enemies
  // armor: flat points, physical multiplier = 60/(60+armor). mres: fraction of magic ignored.
  const ENEMIES = {
    grunt:  { name: 'Grunt',    color: '#9bb05a', speed: 1.30, armor0: 0, armorPer: 0.25, mres: 0,    r: 0.28, gap: 0.75 },
    runner: { name: 'Runner',   color: '#e0793d', speed: 2.40, armor0: 0, armorPer: 0.10, mres: 0,    r: 0.24, gap: 0.50 },
    swarm:  { name: 'Swarmling',color: '#d8c26a', speed: 1.70, armor0: 0, armorPer: 0.10, mres: 0,    r: 0.19, gap: 0.32 },
    tank:   { name: 'Juggernaut',color:'#6f86a6', speed: 1.00, armor0: 6, armorPer: 0.80, mres: 0,    r: 0.36, gap: 1.10 },
    mage:   { name: 'Warded Mage',color:'#b06ad8',speed: 1.30, armor0: 1, armorPer: 0.20, mres: 0.45, r: 0.27, gap: 0.80 },
    flyer:  { name: 'Wyvern',   color: '#5dc2e8', speed: 2.00, armor0: 0, armorPer: 0.15, mres: 0,    r: 0.27, gap: 0.70, air: true },
    boss:   { name: 'Warlord',  color: '#e04b4b', speed: 0.95, armor0: 8, armorPer: 1.00, mres: 0.20, r: 0.50, gap: 1.00, boss: true },
  };

  // Wave template: 10-wave cycle, each cycle ("tier") bigger. share = fraction of the wave HP budget.
  function waveGroups(w) {
    const k = (w - 1) % 10;
    const tier = Math.floor((w - 1) / 10);
    const g = (t, n, share, bountyShare) => ({ t, n, share, bountyShare: bountyShare == null ? share : bountyShare });
    switch (k) {
      case 0: return [g('grunt', 10 + tier * 2, 1)];
      case 1: return [g('runner', 12 + tier * 2, 0.9)];
      case 2: return [g('swarm', 22 + tier * 4, 1)];
      case 3: return [g('tank', 7 + tier, 1.15)];
      case 4: return [g('flyer', 10 + tier * 2, 0.85)];
      case 5: return [g('mage', 10 + tier * 2, 1.0)];
      case 6: return [g('grunt', 8 + tier * 2, 0.5), g('runner', 8 + tier * 2, 0.5)];
      case 7: return [g('tank', 5 + tier, 0.6), g('swarm', 16 + tier * 3, 0.5)];
      case 8: return [g('flyer', 8 + tier * 2, 0.5), g('mage', 8 + tier * 2, 0.55)];
      default: return [g('boss', 1, 0.62, 0.62), g('grunt', 8 + tier * 2, 0.38, 0.38)];
    }
  }

  // Concrete wave: unit hit points / bounty already computed (difficulty applied by the engine).
  function makeWave(w) {
    const T = CFG.hpBudget(w);
    const G = CFG.goldBudget(w);
    return waveGroups(w).map((gr) => {
      const E = ENEMIES[gr.t];
      return {
        t: gr.t, n: gr.n, gap: E.gap,
        hp: (T * gr.share) / gr.n,
        bounty: (G * gr.bountyShare) / gr.n,
        armor: E.armor0 + E.armorPer * w,
      };
    });
  }

  // ---------------------------------------------------------------- towers
  // Each level/branch object is a complete stat block (merged over `base`). `cost` = price of that step.
  // dmg per hit, rate = shots/s, range in cells. dtype: 'phys' (armor) or 'magic' (mres).
  const TOWERS = {
    arrow: {
      name: 'Archer Tower', icon: '🏹', color: '#d9b25a',
      blurb: 'Cheap and quick. Hits ground & air. Weak to armor.',
      base: { targets: 'both', dtype: 'phys', speed: 13 },
      levels: [
        { name: 'Archer Tower', cost: 50,  dmg: 9,  rate: 1.6, range: 3.0 },
        { name: 'Marksman',     cost: 45,  dmg: 17, rate: 1.7, range: 3.2 },
        { name: 'Sharpshooter', cost: 100, dmg: 30, rate: 1.9, range: 3.5 },
      ],
      branches: {
        a: { name: 'Sniper', cost: 230, dmg: 135, rate: 0.62, range: 6.0, crit: { c: 0.25, m: 2.5 },
             desc: 'Huge range & damage, 25% crits. Slow shots.' },
        b: { name: 'Ranger', cost: 210, dmg: 21, rate: 3.0, range: 3.8, multi: 3,
             desc: 'Fires at 3 targets at once.' },
      },
    },
    cannon: {
      name: 'Cannon', icon: '💣', color: '#a0725a',
      blurb: 'Splash damage vs ground packs. Cannot hit air.',
      base: { targets: 'ground', dtype: 'phys', speed: 7 },
      levels: [
        { name: 'Cannon',      cost: 90,  dmg: 36, rate: 0.85, range: 3.2, splash: 1.1 },
        { name: 'Heavy Cannon',cost: 75,  dmg: 64, rate: 0.85, range: 3.4, splash: 1.2 },
        { name: 'Siege Cannon',cost: 160, dmg: 108, rate: 0.85, range: 3.6, splash: 1.4 },
      ],
      branches: {
        a: { name: 'Mortar', cost: 320, dmg: 235, rate: 0.5, range: 6.0, splash: 2.2,
             desc: 'Massive blast radius & range.' },
        b: { name: 'Crusher', cost: 300, dmg: 185, rate: 0.85, range: 3.8, splash: 1.5, shred: { amt: 10, dur: 4 },
             desc: 'Shreds armor (-10) for 4s on hit.' },
      },
    },
    frost: {
      name: 'Frost Tower', icon: '❄️', color: '#7fd0ee',
      blurb: 'Slows enemies. Magic damage. Hits ground & air.',
      base: { targets: 'both', dtype: 'magic', speed: 10 },
      levels: [
        { name: 'Frost Tower',  cost: 75,  dmg: 7,  rate: 1.0, range: 3.0, slow: [0.30, 1.6] },
        { name: 'Ice Spire',    cost: 65,  dmg: 12, rate: 1.1, range: 3.2, slow: [0.38, 1.8] },
        { name: 'Glacier Spire',cost: 130, dmg: 28, rate: 1.2, range: 3.5, slow: [0.46, 2.0] },
      ],
      branches: {
        a: { name: 'Blizzard', cost: 260, dmg: 44, rate: 1.1, range: 3.6, splash: 1.9, slow: [0.46, 2.0],
             desc: 'Area slow & damage.' },
        b: { name: 'Permafrost', cost: 250, dmg: 70, rate: 1.1, range: 3.8, slow: [0.70, 2.2], amp: [0.25, 2.5],
             desc: '70% slow and +25% damage taken.' },
      },
    },
    poison: {
      name: 'Venom Tower', icon: '☠️', color: '#8fcf4a',
      blurb: 'Stacking poison. Magic. Great vs armor & bosses.',
      base: { targets: 'both', dtype: 'magic', speed: 9 },
      levels: [
        { name: 'Venom Tower',  cost: 80,  dmg: 4,  rate: 1.0, range: 3.0, poison: { dps: 16, dur: 4, max: 3 } },
        { name: 'Viper Tower',  cost: 70,  dmg: 6,  rate: 1.1, range: 3.2, poison: { dps: 28, dur: 4, max: 3 } },
        { name: 'Cobra Tower',  cost: 140, dmg: 9,  rate: 1.2, range: 3.4, poison: { dps: 47, dur: 4, max: 4 } },
      ],
      branches: {
        a: { name: 'Plague Spire', cost: 280, dmg: 12, rate: 1.3, range: 3.6, poison: { dps: 70, dur: 4, max: 4 },
             spread: { r: 1.6, frac: 0.6 }, desc: 'Poison spreads to nearby enemies.' },
        b: { name: 'Death Lotus', cost: 300, dmg: 15, rate: 1.1, range: 3.6,
             poison: { dps: 89, dur: 5, max: 5, pct: 0.015, pctCap: 140 }, desc: 'Deep poison; +1.5% max HP/s per stack.' },
      },
    },
    storm: {
      name: 'Storm Tower', icon: '⚡', color: '#f2e45a',
      blurb: 'Chain lightning. Magic. Hits ground & air.',
      base: { targets: 'both', dtype: 'magic', speed: 0 },
      levels: [
        { name: 'Storm Tower',  cost: 120, dmg: 18, rate: 1.0, range: 3.3, chain: { n: 3, r: 1.9, fall: 0.75 } },
        { name: 'Tempest',      cost: 100, dmg: 29, rate: 1.05,range: 3.5, chain: { n: 4, r: 2.0, fall: 0.78 } },
        { name: 'Thunderhead',  cost: 190, dmg: 45, rate: 1.1, range: 3.7, chain: { n: 4, r: 2.1, fall: 0.80 } },
      ],
      branches: {
        a: { name: 'Thunder Lord', cost: 380, dmg: 80, rate: 1.2, range: 4.0, chain: { n: 6, r: 2.3, fall: 0.85 },
             desc: 'Chains through 6 enemies.' },
        b: { name: 'Static Field', cost: 360, dmg: 54, rate: 1.4, range: 3.9, chain: { n: 4, r: 2.1, fall: 0.82 },
             stun: { c: 0.35, d: 0.6 }, desc: '35% chance to stun each target.' },
      },
    },
    flak: {
      name: 'Flak Tower', icon: '🎯', color: '#e07a6a',
      blurb: 'Anti-air only. Splash flak vs flyers.',
      base: { targets: 'air', dtype: 'phys', speed: 12 },
      levels: [
        { name: 'Flak Tower',   cost: 85,  dmg: 32, rate: 1.2, range: 3.7, splash: 1.1 },
        { name: 'Flak Battery', cost: 70,  dmg: 52, rate: 1.3, range: 3.9, splash: 1.2 },
        { name: 'Skyguard',     cost: 140, dmg: 86, rate: 1.4, range: 4.2, splash: 1.3 },
      ],
      branches: {
        a: { name: 'Skyfire', cost: 290, dmg: 420, rate: 0.6, range: 6.5, splash: 0.9,
             desc: 'Long-range anti-air nuke.' },
        b: { name: 'Flak Storm', cost: 270, dmg: 105, rate: 2.6, range: 4.4, splash: 1.5,
             desc: 'Rapid-fire flak, wide splash.' },
      },
    },
  };
  const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'poison', 'storm', 'flak'];

  /** Resolved stat block for a tower at (level 1-3, or 4 with branch 'a'/'b'). */
  function statsFor(key, level, branch) {
    const T = TOWERS[key];
    const s = Object.assign({}, T.base);
    if (level >= 4 && branch) return Object.assign(s, T.branches[branch]);
    return Object.assign(s, T.levels[Math.min(level, 3) - 1]);
  }

  /** Rough single-target sustained DPS before armor (poison/crit/multi included) for UI + balance maths. */
  function dpsOf(s) {
    let d = s.dmg * s.rate;
    if (s.crit) d *= 1 + s.crit.c * (s.crit.m - 1);
    if (s.poison) d += s.poison.dps * Math.min(s.poison.max, Math.max(1, s.poison.dur * s.rate)) ;
    return d;
  }

  const API = { CFG, ENEMIES, TOWERS, TOWER_ORDER, makeWave, waveGroups, statsFor, dpsOf };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else window.TDData = API;
})();
