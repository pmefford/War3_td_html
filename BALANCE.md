# Balance review

Method: `tools/balance.js` runs bot players on the real engine (same code as the game). "Margin" = the largest
multiplier on all enemy HP that a bot still beats; 1.00 = shipped tuning. Mono-tower bots show over/under-powered towers.

## Findings and changes made
1. First tuning (HP 100·1.105^w) was far too easy: Normal bot margin 5.7x, zero leaks until the boss. Raised to
   330·1.14^(w-1)+12w. Result Normal 1.33x, Easy ~2.0x, Hard ~0.9x (bots are mediocre; human mazing/selling beats them).
2. Storm and Archer mono beat the mixed bot (margin 8.5/8.0 vs 5.7) → nerfed Storm chain damage/falloff/count, Sniper, Ranger.
3. Poison and Cannon were weak → Poison DPS +~60%, Cannon damage +~35-55%. Cannon alone loses at the first air wave (by design: needs Flak).
4. Frost is support (mono dies wave 5) – intended; it shines with damage towers (Permafrost +25% dmg taken).
5. Hard leaked at waves 3–4 → Hard start gold 190→215, HP x1.3→1.25.
6. Early-send bonus (≤~18g/wave) does not change margins (1.34 vs 1.33): no exploit.
7. Portrait (10x14, path 40) vs landscape (16x10, path 54) margins equal within noise.

## Economy summary
Gold budget/wave = 52+8w (+ clear bonus 6+1.2w); a full run earns ~10k gold, enough for ~30 towers mostly at final tier
(cost 380–790 each incl. upgrades). Walls appear at flyer waves (5/15/25/35), warded/armored waves and bosses (every 10th),
so a mixed build with anti-air is required. Sell refund 70%.

## Known limits
Bots don't maze, sell or reposition; real difficulty for humans is lower. No mid-game save. Not tested on real devices
(only headless Chromium at 390x780 and 1280x760).
