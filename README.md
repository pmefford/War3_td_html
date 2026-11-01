# Bastion TD

Maze-building tower defense (Warcraft 3 custom-map style) in plain HTML/JS. No build tools needed.

## Play it
* **Quickest:** open `dist/bastion-td.html` (single file, works offline from file://).
* **As an app with a home-screen icon (PWA):** host the folder over HTTPS (GitHub Pages workflow included: enable
  *Settings → Pages → Source: GitHub Actions*, merge to `main`), open the URL in Chrome/Safari, then
  *Add to Home screen / Install app*. It then runs fullscreen and offline.
* Local dev: `python3 -m http.server` and open `http://localhost:8000`.

## Game
* Enemies walk spawn → ① → ② → exit; towers are obstacles, so you build the maze (the path can never be fully blocked).
* 6 towers, each 3 linear upgrades then a **2-way specialisation** (e.g. Archer → Sniper / Ranger).
* Enemy types: grunt, runner, swarm, armored juggernaut, magic-warded mage, flying wyvern (ignores maze), boss every 10 waves.
* 40 waves, then optional endless. Easy / Normal / Hard.

## Balance review (tools/balance.js)
Bots play the real engine headlessly: `node tools/balance.js` (matrix), `detail normal mixed` (per-wave),
`margin` (largest HP multiplier each bot still beats). See `BALANCE.md`.

## Layout
`src/data.js` towers/enemies/waves/economy · `src/engine.js` simulation · `src/ui.js` rendering+input · `tools/` sim, icons, bundler.
Rebuild bundle: `node tools/build-single.js`.
