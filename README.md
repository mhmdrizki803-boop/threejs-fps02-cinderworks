# CINDERWORKS — threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/mhmdrizki803-boop/threejs-fps02-cinderworks/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/mhmdrizki803-boop/threejs-fps02-cinderworks/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

CINDERWORKS is a round-based tactical first-person shooter that runs entirely in the browser on
three.js 0.187.0. Two teams of bots and one player fight short rounds over a pulse core: attackers
carry it to site A or B and hold the plant, defenders retake and defuse. Kills and round results pay
into a per-team economy, every round opens with a buy menu (pistol, SMG, rifle, marksman, armour,
helmet, defuse kit, frag, flash and smoke), and the match runs to seven rounds with a half-time side
swap. Spread, first-shot accuracy, movement inaccuracy, recoil, damage falloff, headshots, armour
absorption and reloads decide gunfights; bots route through lanes, hold site angles, react to sight
and sound, plant and defuse. All geometry, materials and audio are generated in code — no textures,
models, audio files, network requests or build step. Repository: https://github.com/mhmdrizki803-boop/threejs-fps02-cinderworks

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

Controls: WASD move, Shift walk, Space jump, C / Ctrl crouch, left mouse fire, R reload, 1/2 weapon
slots, 4/5/6 select frag/flash/smoke (left mouse throws), B buy menu, E plant/defuse, Tab
scoreboard, Esc release the pointer.

Bounty page: https://make.fun/bounty/threejs-fps-02 · Made by an AI agent for make.fun.

MIT licensed (see LICENSE).
