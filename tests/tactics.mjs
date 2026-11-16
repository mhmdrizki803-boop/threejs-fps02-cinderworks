#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const PORT = 8188;
const VERBOSE = process.argv.includes('--verbose');
const ORIGIN = `http://localhost:${PORT}`;
const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE
  || '../../shots/node_modules/playwright-core/index.mjs';
const CHROME_BIN = process.env.CHROME_BIN
  || '/home/ubuntu/.hermes/tools/chromium-1208/chrome-linux64/chrome';
const TIMEOUT = { server: 15_000, launch: 30_000, page: 45_000, case: 30_000, cleanup: 10_000 };
const EXPOSE_MAIN = `
;window.testGame = {
  map, bots, match, player, input, loadout, botCtx, matchCtx, hud, rowsForBoard,
  pickupBombIfDropped, updateObjective, simulationStep, restartMatch, buyItem,
  shoot, applyDamage, grenades, updateGrenades, effects, scene, throwGrenade
};
`;

const cases = [];
const counts = { assertions: 0, passed: 0, failed: 0, cases: 0 };
let currentCase = 'Persiapan';

function test(name, run, side = 'attack') {
  cases.push({ name, run, side });
}

function evidence(value) {
  return inspect(value, { depth: 8, compact: true, breakLength: Infinity, maxArrayLength: null });
}

function equal(label, actual, expected, detail) {
  counts.assertions += 1;
  let status = 'PASS';
  try {
    assert.deepStrictEqual(actual, expected);
    counts.passed += 1;
  } catch {
    status = 'FAIL';
    counts.failed += 1;
  }
  const line = `${status} ${String(counts.assertions).padStart(3, '0')} [${currentCase}] ${label}`
    + ` | aktual=${evidence(actual)}; harapan=${evidence(expected)}`
    + (detail === undefined ? '' : `; bukti=${evidence(detail)}`);
  if (status === 'PASS') { if (VERBOSE) console.log(line); }
  else console.error(line);
}

function failure(label, error) {
  equal(label, error instanceof Error ? error.message : String(error), null);
}

async function timed(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label}: melewati batas ${milliseconds} ms`);
          error.code = 'TACTICS_TIMEOUT';
          reject(error);
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Startup server melewati batas waktu')), TIMEOUT.server);
    function finish(error) {
      clearTimeout(timer);
      server.stdout.off('data', onData);
      server.off('error', onError);
      server.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    }
    function onData(chunk) {
      output += chunk.toString();
      if (output.includes(`game/ is on ${ORIGIN}`)) finish();
    }
    function onError(error) { finish(error); }
    function onExit(code, signal) {
      finish(new Error(`Server berhenti sebelum siap: kode=${code}, sinyal=${signal}`));
    }
    server.stdout.on('data', onData);
    server.once('error', onError);
    server.once('exit', onExit);
  });
}

async function stopServer(server) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const killTimer = setTimeout(() => server.kill('SIGKILL'), 2_000);
    const deadline = setTimeout(() => finish(new Error('Server gagal berhenti setelah SIGKILL')), 5_000);
    function finish(error) {
      clearTimeout(killTimer);
      clearTimeout(deadline);
      server.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    }
    function onExit() { finish(); }
    server.once('exit', onExit);
    try { server.kill('SIGTERM'); } catch (error) { finish(error); }
  });
}

// Helper browser dipasang terpisah dari sumber main. Semua fixture memakai API nyata.
async function installHelpers(page) {
  await page.evaluate(async () => {
    const g = window.testGame;
    const teams = ['ember', 'warden'];
    const { createMover } = await import('/src/physics.js');
    const mover = createMover(g.map.colliders);
    const dt = 1 / 60;
    const position = (bot) => ({ x: bot.position.x, y: bot.position.y, z: bot.position.z });
    window.tactics = {
      restoreBotContext() {
        Object.assign(g.botCtx, {
          bots: g.bots.roster, player: g.player.state,
          combatants: [g.player.state, ...g.bots.roster], bomb: g.match.state.bomb,
          now: g.match.state.now, attackerTeam: g.match.state.attackerTeam,
        });
      },
      isolateBots() {
        this.restoreBotContext();
        g.botCtx.combatants = [];
        g.match.state.phase = 'live';
        g.input.state.keys.clear();
        g.hud.setBuyOpen(false);
        g.hud.setBoardOpen(false);
      },
      blocked(x, z, bot) {
        return Boolean(mover.overlaps(x, (bot?.position.y ?? 0) + 0.05, z,
          bot?.radius ?? 0.34, bot?.height ?? 1.76, 0.06));
      },
      angleError(actual, expected) {
        return Math.abs(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)));
      },
      actor(bot) {
        if (!bot) return null;
        const goal = bot.path.at(-1);
        return {
          id: bot.id, name: bot.name, team: bot.team, alive: bot.alive,
          anchor: bot.anchor, holding: bot.holding, recovering: bot.recovering,
          siteId: bot.siteId, routeIndex: bot.routeIndex, repathTimer: bot.repathTimer,
          interacting: bot.interacting, position: position(bot), yaw: bot.yaw,
          pathGoal: goal ? { x: goal.x, z: goal.z } : null,
        };
      },
      bomb() {
        const bomb = g.match.state.bomb;
        return {
          state: bomb.state, siteId: bomb.siteId,
          carrierId: bomb.carrier === g.player.state ? 'YOU' : bomb.carrier?.id ?? null,
          defuserId: bomb.defuser === g.player.state ? 'YOU' : bomb.defuser?.id ?? null,
          position: { ...bomb.position }, plantProgress: bomb.plantProgress,
          defuseProgress: bomb.defuseProgress,
        };
      },
      // Jam logis maju sebelum bots.step; tidak menggerakkan player atau melewati ronde.
      botTick({ objectives = false, beforeObjective } = {}) {
        g.botCtx.now += dt;
        g.match.state.now = g.botCtx.now;
        g.bots.step(dt, g.botCtx);
        if (objectives) {
          g.pickupBombIfDropped();
          beforeObjective?.();
          g.updateObjective(dt);
        }
      },
      advanceBots(ticks, { watch = [], objectives = false, until, face,
        beforeObjective, observe } = {}) {
        if (!Number.isInteger(ticks) || ticks < 0 || ticks > 3600) {
          throw new Error('Jumlah tick bot harus integer 0..3600');
        }
        const traces = watch.map((bot) => ({
          id: bot.id, start: position(bot), end: position(bot), distance: 0, maxStep: 0,
          collisions: Number(this.blocked(bot.position.x, bot.position.z, bot)),
          holdingTicks: 0, maxYawError: face ? 0 : null,
        }));
        let executed = 0;
        for (let tick = 1; tick <= ticks; tick += 1) {
          const before = watch.map(position);
          this.botTick({ objectives, beforeObjective: () => beforeObjective?.(tick) });
          watch.forEach((bot, index) => {
            const trace = traces[index];
            const moved = Math.hypot(bot.position.x - before[index].x,
              bot.position.y - before[index].y, bot.position.z - before[index].z);
            trace.distance += moved;
            trace.maxStep = Math.max(trace.maxStep, moved);
            trace.collisions += Number(this.blocked(bot.position.x, bot.position.z, bot));
            trace.holdingTicks += Number(bot.holding === true);
            trace.end = position(bot);
            if (face) {
              const approach = face(bot);
              const yaw = Math.atan2(-(approach.x - bot.position.x), -(approach.z - bot.position.z));
              trace.maxYawError = Math.max(trace.maxYawError, this.angleError(bot.yaw, yaw));
            }
          });
          executed = tick;
          observe?.(tick);
          if (until?.()) break;
        }
        return { ticks: executed, traces };
      },
      settleAnchors() {
        const anchors = g.bots.roster.filter((bot) => bot.anchor);
        const reached = () => anchors.length === 2 && anchors.every((bot) => {
          const hold = g.map.sites[bot.siteId].hold;
          return bot.holding === true && Math.hypot(bot.position.x - hold.x, bot.position.z - hold.z) < 0.9;
        });
        const travel = this.advanceBots(1800, { watch: anchors, until: reached });
        const arrived = reached();
        this.advanceBots(90, { watch: anchors });
        return { anchors, arrived, travel };
      },
      setEconomy({ money = 2000, lossStreak = { ember: 0, warden: 0 },
        primaryId = null, armor = 0, helmet = false, hasKit = false } = {}) {
        Object.assign(g.match.state.lossStreak, lossStreak);
        for (const bot of g.bots.roster) {
          Object.assign(bot, { money, primaryId, armor, helmet, hasKit });
        }
        g.bots.refreshGuns();
      },
      bots() {
        return g.bots.roster.map((bot) => ({
          name: bot.name, team: bot.team, alive: bot.alive, eco: bot.eco,
          money: bot.money, primaryId: bot.primaryId, armor: bot.armor,
          helmet: bot.helmet, hasKit: bot.hasKit, gunId: bot.gun.id,
        }));
      },
      balances() {
        return {
          player: g.match.state.playerMoney,
          ember: g.bots.roster.filter((bot) => bot.team === 'ember').map((bot) => bot.money),
          warden: g.bots.roster.filter((bot) => bot.team === 'warden').map((bot) => bot.money),
        };
      },
      match() {
        const s = g.match.state;
        return {
          phase: s.phase, round: s.round, roundTimer: s.roundTimer, buyTimer: s.buyTimer,
          attackerTeam: s.attackerTeam, playerTeam: s.playerTeam,
          scores: { ...s.scores }, lossStreak: { ...s.lossStreak },
          playerMoney: s.playerMoney, roundWinner: s.roundWinner, matchWinner: s.matchWinner,
          swapped: s.swapped, now: s.now,
        };
      },
      board() {
        const rows = g.rowsForBoard();
        g.hud.refreshBoard(rows, g.match.state);
        const titles = {};
        const labels = {};
        const domRows = {};
        for (const team of teams) {
          const heading = document.querySelector(`.board-team.${team} h3`);
          titles[team] = heading?.textContent.replace(/\s+/g, ' ').trim() ?? null;
          labels[team] = titles[team]?.match(/TOTAL \$(\d+)(?=\s|$)/)?.[1] ?? null;
          domRows[team] = [...document.querySelectorAll(`.board-team.${team} tbody tr`)].map((row) => ({
            money: row.querySelector('td.m')?.textContent.trim() ?? null,
            dead: row.classList.contains('dead'), me: row.classList.contains('me'),
          }));
        }
        return { rows, titles, labels, domRows };
      },
      // Ekstensi bot/granat/gunplay dapat melangkah tanpa menunggu jam atau frame browser.
      step(ticks = 1) {
        if (!Number.isInteger(ticks) || ticks < 0 || ticks > 3600) {
          throw new Error('Jumlah tick harus integer 0..3600');
        }
        for (let tick = 0; tick < ticks; tick += 1) g.simulationStep(1 / 60);
      },
    };
  });
}

const ECO = { eco: true, money: 2000, primaryId: null, armor: 0, helmet: false, hasKit: false, gunId: 'kestrel' };
const SMG = { eco: false, money: 100, primaryId: 'rattler', armor: 100, helmet: false, hasKit: false, gunId: 'rattler' };
const RIFLE = { eco: false, money: 0, primaryId: 'longbow', armor: 100, helmet: false, hasKit: false, gunId: 'longbow' };

function expectBots(rows, expected, stage = 'Pembelian') {
  for (const bot of rows) {
    const { eco, money, primaryId, armor, helmet, hasKit, gunId } = bot;
    equal(`${stage}: ${bot.name}/${bot.team}`,
      { eco, money, primaryId, armor, helmet, hasKit, gunId },
      typeof expected === 'function' ? expected(bot) : expected);
  }
}

function expectBoard(snapshot, expected, stage) {
  for (const team of ['ember', 'warden']) {
    const total = snapshot.rows.filter((row) => row.team === team).reduce((sum, row) => sum + row.money, 0);
    equal(`${stage}: total data ${team}`, total, expected[team]);
    equal(`${stage}: judul ${team}`, snapshot.labels[team], String(expected[team]), snapshot.titles[team]);
  }
}

test('Dua kekalahan: sekutu eco, lawan membeli', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ lossStreak: { ember: 2, warden: 0 } });
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    g.bots.refreshGuns();
    return { bots: window.tactics.bots(), lossStreak: { ...g.match.state.lossStreak } };
  });
  equal('Roster kedua tim', {
    ember: result.bots.filter((bot) => bot.team === 'ember').length,
    warden: result.bots.filter((bot) => bot.team === 'warden').length,
  }, { ember: 4, warden: 5 });
  expectBots(result.bots, (bot) => bot.team === 'ember' ? ECO : SMG);
  equal('Semua uang integer dan tidak negatif', result.bots.every((bot) => Number.isInteger(bot.money) && bot.money >= 0),
    true, result.bots.map((bot) => [bot.name, bot.money]));
  equal('Pembelian mempertahankan streak tim', result.lossStreak, { ember: 2, warden: 0 });
});

test('Satu kekalahan tetap membeli normal', async (page) => {
  const rows = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ lossStreak: { ember: 1, warden: 1 } });
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    g.bots.refreshGuns();
    return window.tactics.bots();
  });
  expectBots(rows, SMG);
});

test('Ambang tepat $3350 membeli rifle dan armor', async (page) => {
  const rows = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ money: 3350, lossStreak: { ember: 2, warden: 2 } });
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    g.bots.refreshGuns();
    return window.tactics.bots();
  });
  expectBots(rows, RIFLE);
});

test('Default streak dan uang di atas ambang bukan eco', async (page) => {
  const rows = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ money: 3351 });
    g.bots.buy(g.match.state.attackerTeam);
    g.bots.refreshGuns();
    return window.tactics.bots();
  });
  expectBots(rows, { ...RIFLE, money: 1 });
});

test('Eco khusus tim saat pemain menjadi defender', async (page) => {
  const rows = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ lossStreak: { ember: 2, warden: 0 } });
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    g.bots.refreshGuns();
    return window.tactics.bots();
  });
  expectBots(rows, (bot) => bot.team === 'ember' ? ECO : SMG);
}, 'defend');

test('Eco berulang mempertahankan senjata dan armor', async (page) => {
  const history = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({
      lossStreak: { ember: 2, warden: 2 }, primaryId: 'longbow', armor: 73,
    });
    const history = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
      history.push(window.tactics.bots());
    }
    return history;
  });
  history.forEach((rows, index) => expectBots(rows,
    { ...ECO, primaryId: 'longbow', armor: 73, gunId: 'longbow' }, `Eco ulang ${index + 1}`));
});

test('Reset streak memulihkan kemampuan membeli', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ lossStreak: { ember: 2, warden: 0 } });
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    const before = window.tactics.bots().filter((bot) => bot.team === 'ember');
    g.match.state.lossStreak.ember = 0;
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    g.bots.refreshGuns();
    return { before, after: window.tactics.bots(), lossStreak: { ...g.match.state.lossStreak } };
  });
  expectBots(result.before, ECO, 'Sebelum reset');
  expectBots(result.after, SMG, 'Sesudah reset');
  equal('Streak selesai direset', result.lossStreak, { ember: 0, warden: 0 });
});

test('Ronde baru meneruskan streak ke pembelian bot', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    window.tactics.setEconomy({ lossStreak: { ember: 2, warden: 0 } });
    Object.assign(g.match.state.scores, { ember: 0, warden: 2 });
    Object.assign(g.match.state, { phase: 'roundEnd', phaseTimer: 5, round: 2 });
    g.match.step(5, g.matchCtx);
    return { bots: window.tactics.bots(), match: window.tactics.match() };
  });
  equal('Ronde ketiga memasuki fase beli', {
    phase: result.match.phase, round: result.match.round,
    scores: result.match.scores, lossStreak: result.match.lossStreak,
  }, { phase: 'buy', round: 3, scores: { ember: 0, warden: 2 }, lossStreak: { ember: 2, warden: 0 } });
  expectBots(result.bots, (bot) => bot.team === 'ember' ? ECO : SMG);
});

test('Total papan skor mengikuti kill, beli, dan pemain mati', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    const allies = g.bots.roster.filter((bot) => bot.team === 'ember');
    const enemies = g.bots.roster.filter((bot) => bot.team === 'warden');
    const allyMoney = [111, 222, 333, 444];
    const enemyMoney = [505, 2000, 707, 808, 909];
    for (const bot of g.bots.roster) {
      Object.assign(bot, { primaryId: 'longbow', armor: 100, helmet: true, hasKit: bot.team === 'warden' });
    }
    allies.forEach((bot, index) => { bot.money = allyMoney[index]; });
    enemies.forEach((bot, index) => { bot.money = enemyMoney[index]; });
    Object.assign(allies[0], { alive: false, health: 0 });
    Object.assign(enemies[4], { alive: false, health: 0 });
    g.match.state.playerMoney = 4000;
    g.match.state.phase = 'live';
    g.bots.refreshGuns();
    g.hud.setBuyOpen(false);
    g.hud.setBoardOpen(true);
    const baseline = t.board();
    g.applyDamage(enemies[0], 1000, 'body', g.player.state, { name: 'KESTREL-9' });
    const playerKill = t.board();
    g.applyDamage(allies[1], 1000, 'body', enemies[1], { name: 'RATTLER' });
    const botKill = t.board();
    g.match.state.phase = 'buy';
    g.buyItem('armor');
    const playerBuy = t.board();
    Object.assign(enemies[1], { primaryId: null, armor: 0, helmet: false, hasKit: false });
    g.bots.buy(g.match.state.attackerTeam, g.match.state.lossStreak);
    g.bots.refreshGuns();
    const botBuy = t.board();
    const bought = t.bots().find((bot) => bot.name === enemies[1].name);
    g.match.state.phase = 'live';
    g.applyDamage(g.player.state, 1000, 'body', enemies[1], { name: 'RATTLER' });
    const playerDeath = t.board();
    return {
      baseline, playerKill, botKill, playerBuy, botBuy, playerDeath, bought,
      player: { money: g.match.state.playerMoney, armor: g.player.state.armor,
        alive: g.player.state.alive, kills: g.player.state.kills, deaths: g.player.state.deaths },
      match: t.match(),
    };
  });
  expectBoard(result.baseline, { ember: 5110, warden: 4929 }, 'Awal');
  equal('Papan memuat pemain dan sembilan bot', result.baseline.rows.length, 10);
  equal('Bot mati Ember tetap memiliki baris uang', result.baseline.domRows.ember.filter((row) => row.dead).map((row) => row.money), ['$111']);
  equal('Bot mati Warden tetap memiliki baris uang', result.baseline.domRows.warden.filter((row) => row.dead).map((row) => row.money), ['$909']);
  equal('Baris pemain menyertakan $4000', result.baseline.domRows.ember.filter((row) => row.me),
    [{ money: '$4000', dead: false, me: true }]);
  expectBoard(result.playerKill, { ember: 5410, warden: 4929 }, 'Reward pemain +$300');
  expectBoard(result.botKill, { ember: 5410, warden: 5229 }, 'Reward bot +$300');
  expectBoard(result.playerBuy, { ember: 4760, warden: 5229 }, 'Armor pemain -$650');
  expectBoard(result.botBuy, { ember: 4760, warden: 2929 }, 'Pembelian defender -$2300');
  expectBots([result.bought], { ...SMG, money: 0, hasKit: true });
  expectBoard(result.playerDeath, { ember: 4760, warden: 3229 }, 'Pemain mati, reward bot +$300');
  equal('Pemain mati tetap tercantum dengan uangnya', result.playerDeath.domRows.ember.filter((row) => row.me),
    [{ money: '$3650', dead: true, me: true }]);
  equal('Reward pemain dan harga armor', result.player.money, 3650);
  equal('Kill/death pemain benar-benar terjadi', { alive: result.player.alive, kills: result.player.kills, deaths: result.player.deaths },
    { alive: false, kills: 1, deaths: 1 });
  equal('Kill fixture tidak memicu payout ronde', { phase: result.match.phase, scores: result.match.scores },
    { phase: 'live', scores: { ember: 0, warden: 0 } });
});

test('Helmet $1000 sudah mencakup armor dan tidak dibeli ulang', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    g.match.state.playerMoney = 2000;
    const snapshot = () => ({ money: g.match.state.playerMoney, armor: g.player.state.armor, helmet: g.player.state.helmet });
    g.buyItem('helmet');
    const helmet = snapshot();
    g.buyItem('armor');
    const armor = snapshot();
    g.buyItem('helmet');
    return { helmet, armor, repeated: snapshot() };
  });
  const expected = { money: 1000, armor: 100, helmet: true };
  equal('Helmet mencakup armor100', result.helmet, expected);
  equal('Armor milik sendiri tidak dibayar lagi', result.armor, expected);
  equal('Helmet milik sendiri tidak dibayar lagi', result.repeated, expected);
});

for (const side of ['attack', 'defend']) {
  test(`Kit $400 khusus defender: ${side}`, async (page) => {
    const result = await page.evaluate(() => {
      const g = window.testGame;
      g.match.state.playerMoney = 400;
      g.buyItem('kit');
      return { money: g.match.state.playerMoney, kit: g.loadout.kit, armor: g.player.state.armor };
    });
    equal('Hak beli kit dan harga', result,
      { money: side === 'defend' ? 0 : 400, kit: side === 'defend', armor: 0 });
  }, side);
}

for (const side of ['attack', 'defend']) {
  test(`FinishRound membayar kedua tim dan bot mati: ${side}`, async (page) => {
    const result = await page.evaluate(() => {
      const g = window.testGame;
      const t = window.tactics;
      const winner = g.player.state.team;
      const loser = winner === 'ember' ? 'warden' : 'ember';
      t.setEconomy({ money: 1000 });
      g.match.state.playerMoney = 1000;
      g.match.state.scores[winner] = 2;
      g.match.state.scores[loser] = 1;
      g.match.state.lossStreak[winner] = 3;
      g.bots.roster.find((bot) => bot.team === winner).alive = false;
      g.bots.roster.find((bot) => bot.team === loser).alive = false;
      g.match.state.phase = 'live';
      g.match.finishRound(winner, 'PAYOUT TEST', g.matchCtx);
      const first = { match: t.match(), balances: t.balances() };
      const dead = t.bots().filter((bot) => !bot.alive).map(({ team, money }) => ({ team, money }));
      g.match.finishRound(winner, 'PAYOUT DUPLIKAT', g.matchCtx);
      return { first, dead, repeated: { match: t.match(), balances: t.balances() } };
    });
    const winner = side === 'attack' ? 'ember' : 'warden';
    const loser = winner === 'ember' ? 'warden' : 'ember';
    equal('Pemain menang menerima $3250', result.first.balances.player, 4250);
    for (const team of ['ember', 'warden']) {
      equal(`Payout bot ${team}`, result.first.balances[team],
        Array(team === winner ? 4 : 5).fill(team === winner ? 4250 : 2400));
    }
    equal('Bot mati tetap menerima payout', result.dead,
      [{ team: winner, money: 4250 }, { team: loser, money: 2400 }]);
    equal('Skor bertambah dan streak pemenang direset', {
      phase: result.first.match.phase, scores: result.first.match.scores,
      lossStreak: result.first.match.lossStreak, roundWinner: result.first.match.roundWinner,
      matchWinner: result.first.match.matchWinner,
    }, { phase: 'roundEnd', scores: { [winner]: 3, [loser]: 1 },
      lossStreak: { [winner]: 0, [loser]: 1 }, roundWinner: winner, matchWinner: null });
    equal('FinishRound kedua tidak membayar ulang', result.repeated, result.first);
  }, side);
}

test('Bonus kalah meningkat dan berhenti pada $3400', async (page) => {
  const history = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    t.setEconomy({ money: 0, lossStreak: { ember: 0, warden: 3 } });
    g.match.state.playerMoney = 0;
    const history = [];
    // FinishRound diuji langsung: fase live dipasang per ronde agar buy tidak mengurangi payout.
    for (let round = 1; round <= 6; round += 1) {
      const before = g.match.state.playerMoney;
      g.match.state.phase = 'live';
      g.match.state.round = round;
      g.match.finishRound('warden', `LOSS ${round}`, g.matchCtx);
      history.push({ delta: g.match.state.playerMoney - before, match: t.match(), balances: t.balances() });
    }
    return history;
  });
  const bonuses = [1400, 1900, 2400, 2900, 3400, 3400];
  equal('Enam payout tercatat', history.length, bonuses.length);
  let balance = 0;
  history.forEach((entry, index) => {
    balance += bonuses[index];
    equal(`Kalah ${index + 1}: bonus`, entry.delta, bonuses[index]);
    equal(`Kalah ${index + 1}: saldo pemain`, entry.balances.player, balance);
    equal(`Kalah ${index + 1}: saldo bot kalah`, entry.balances.ember, Array(4).fill(balance));
    equal(`Kalah ${index + 1}: saldo bot menang`, entry.balances.warden,
      Array(5).fill(Math.min(16000, (index + 1) * 3250)));
    equal(`Kalah ${index + 1}: skor dan streak`, { scores: entry.match.scores, lossStreak: entry.match.lossStreak },
      { scores: { ember: 0, warden: index + 1 }, lossStreak: { ember: index + 1, warden: 0 } });
  });
});

test('Payout dan kill reward dibatasi $16000', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    t.setEconomy({ money: 15950, lossStreak: { ember: 4, warden: 4 } });
    g.match.state.playerMoney = 15950;
    g.match.state.phase = 'live';
    g.match.finishRound('warden', 'CAP TEST', g.matchCtx);
    const payout = t.balances();
    g.match.addKillReward(g.player.state, 300);
    for (const bot of g.bots.roster) g.match.addKillReward(bot, 300);
    const atCap = t.balances();
    g.match.state.playerMoney = 15750;
    for (const bot of g.bots.roster) bot.money = 15750;
    g.match.addKillReward(g.player.state, 300);
    for (const bot of g.bots.roster) g.match.addKillReward(bot, 300);
    return { payout, atCap, crossing: t.balances(), match: t.match() };
  });
  const cap = { player: 16000, ember: Array(4).fill(16000), warden: Array(5).fill(16000) };
  equal('Payout menang dan kalah mencapai cap', result.payout, cap);
  equal('Reward pada cap tidak menambah saldo', result.atCap, cap);
  equal('Reward yang melintasi cap berhenti di $16000', result.crossing, cap);
  equal('Streak diperbarui walau uang mencapai cap', result.match.lossStreak, { ember: 5, warden: 0 });
});

test('Halftime mempertahankan skor dan mereset streak', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    t.setEconomy({ money: 2000, lossStreak: { ember: 4, warden: 2 } });
    Object.assign(g.match.state.scores, { ember: 2, warden: 3 });
    Object.assign(g.match.state, { phase: 'live', round: 6 });
    let beforeBuy;
    const ctx = { ...g.matchCtx, onRoundStart() {
      beforeBuy = { match: t.match(), balances: t.balances() };
      g.matchCtx.onRoundStart();
    } };
    g.match.finishRound('warden', 'HALFTIME TEST', ctx);
    g.match.step(5, ctx);
    const halftime = t.match();
    g.match.step(4.5, ctx);
    return { halftime, beforeBuy, after: t.match(), bots: t.bots() };
  });
  equal('Ronde enam berakhir pada halftime', { phase: result.halftime.phase, scores: result.halftime.scores },
    { phase: 'halftime', scores: { ember: 2, warden: 4 } });
  equal('Saldo direset sebelum pembelian otomatis', result.beforeBuy?.balances,
    { player: 800, ember: Array(4).fill(800), warden: Array(5).fill(800) });
  equal('Streak direset sebelum pembelian otomatis', result.beforeBuy?.match.lossStreak, { ember: 0, warden: 0 });
  equal('Sisi berganti, skor tetap, ronde tujuh dimulai', {
    phase: result.after.phase, round: result.after.round, attackerTeam: result.after.attackerTeam,
    scores: result.after.scores, lossStreak: result.after.lossStreak, swapped: result.after.swapped,
  }, { phase: 'buy', round: 7, attackerTeam: 'warden', scores: { ember: 2, warden: 4 },
    lossStreak: { ember: 0, warden: 0 }, swapped: true });
  equal('Reset halftime mengakhiri eco semua bot', result.bots.map((bot) => bot.eco), Array(9).fill(false));
});

test('Match selesai lalu restart mereset skor dan streak', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    Object.assign(g.match.state.scores, { ember: 6, warden: 4 });
    Object.assign(g.match.state.lossStreak, { ember: 3, warden: 2 });
    Object.assign(g.match.state, { phase: 'live', round: 11, swapped: true, now: 123 });
    g.player.state.kills = 8;
    g.player.state.deaths = 2;
    for (const bot of g.bots.roster) {
      Object.assign(bot, { kills: 6, deaths: 3, primaryId: 'longbow', armor: 73 });
    }
    g.match.finishRound('ember', 'MATCH END TEST', g.matchCtx);
    const finished = t.match();
    g.match.step(5, g.matchCtx);
    const ended = t.match();
    g.restartMatch('attack');
    t.restoreBotContext();
    return {
      finished, ended, reset: t.match(),
      player: { kills: g.player.state.kills, deaths: g.player.state.deaths, alive: g.player.state.alive,
        primaryId: g.loadout.primaryId, armor: g.player.state.armor, helmet: g.player.state.helmet },
      bots: g.bots.roster.map((bot) => ({ kills: bot.kills, deaths: bot.deaths, alive: bot.alive,
        primaryId: bot.primaryId, eco: bot.eco })),
    };
  });
  equal('Kemenangan ketujuh menandai pemenang match', {
    phase: result.finished.phase, scores: result.finished.scores, lossStreak: result.finished.lossStreak,
    roundWinner: result.finished.roundWinner, matchWinner: result.finished.matchWinner,
  }, { phase: 'roundEnd', scores: { ember: 7, warden: 4 }, lossStreak: { ember: 0, warden: 3 },
    roundWinner: 'ember', matchWinner: 'ember' });
  equal('Transisi akhir match', { phase: result.ended.phase, matchWinner: result.ended.matchWinner },
    { phase: 'matchEnd', matchWinner: 'ember' });
  equal('Restart mereset state match', result.reset, {
    phase: 'buy', round: 1, roundTimer: 100, buyTimer: 15, attackerTeam: 'ember', playerTeam: 'ember',
    scores: { ember: 0, warden: 0 }, lossStreak: { ember: 0, warden: 0 }, playerMoney: 800,
    roundWinner: null, matchWinner: null, swapped: false, now: 0,
  });
  equal('Restart mereset karier pemain', result.player,
    { kills: 0, deaths: 0, alive: true, primaryId: null, armor: 0, helmet: false });
  equal('Restart mereset karier dan eco bot', result.bots,
    Array.from({ length: 9 }, () => ({ kills: 0, deaths: 0, alive: true, primaryId: null, eco: false })));
});

const HOLD_POINTS = { A: { x: -12, z: -8 }, B: { x: 12, z: -8 } };
const APPROACH_POINTS = { A: { x: -12, z: -1 }, B: { x: 12, z: -1 } };
const distanceXZ = (a, b) => a && b ? Math.hypot(a.x - b.x, a.z - b.z) : NaN;
const traceFor = (run, id) => run?.traces.find((trace) => trace.id === id);

test('Geometri hold A/B bebas collision dan melihat approach', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    return Object.fromEntries(['A', 'B'].map((id) => {
      const hold = g.map.sites[id].hold;
      const approach = g.map.routes[id][2].at(-1);
      return [id, {
        hold: hold ? { ...hold } : null, approach: { ...approach },
        gridOpen: Boolean(hold && !g.map.isSolid(hold.x, hold.z)),
        bodyClear: Boolean(hold && !t.blocked(hold.x, hold.z)),
        sight: Boolean(hold && g.map.lineOfSight(hold.x, hold.z, approach.x, approach.z)),
      }];
    }));
  });
  for (const site of ['A', 'B']) {
    equal(`Hold ${site} sesuai kontrak`, result[site].hold, HOLD_POINTS[site]);
    equal(`Approach akhir ${site} sesuai kontrak`, result[site].approach, APPROACH_POINTS[site]);
    const { gridOpen, bodyClear, sight } = result[site];
    equal(`Hold ${site} dapat ditempati dan melihat approach`, { gridOpen, bodyClear, sight },
      { gridOpen: true, bodyClear: true, sight: true });
  }
});

for (const side of ['attack', 'defend']) {
  for (const swapped of [false, true]) {
    test(`Dua anchor menahan A/B: pemain ${side}, ${swapped ? 'halftime' : 'awal'}`, async (page) => {
      const result = await page.evaluate(({ swapped, approaches }) => {
        const g = window.testGame;
        const t = window.tactics;
        if (swapped) {
          Object.assign(g.match.state, { phase: 'halftime', phaseTimer: 4.5, round: 6 });
          g.match.step(4.5, g.matchCtx);
        }
        t.isolateBots();
        const assignment = g.bots.roster.filter((bot) => bot.anchor)
          .map((bot) => ({ site: bot.siteId, team: bot.team })).sort((a, b) => a.site.localeCompare(b.site));
        const attackersWithAnchor = g.bots.roster.filter((bot) => bot.team === g.match.state.attackerTeam && bot.anchor)
          .map((bot) => bot.id);
        const { anchors, arrived, travel } = t.settleAnchors();
        const stable = t.advanceBots(120, { watch: anchors, face: (bot) => approaches[bot.siteId] });
        return {
          assignment, attackersWithAnchor, arrived, travel, stable,
          actors: anchors.map((bot) => t.actor(bot)),
          teams: { player: g.player.state.team, attacker: g.match.state.attackerTeam,
            contextAttacker: g.botCtx.attackerTeam, swapped: g.match.state.swapped },
        };
      }, { swapped, approaches: APPROACH_POINTS });
      const attacker = swapped ? 'warden' : 'ember';
      const defender = swapped ? 'ember' : 'warden';
      equal('Tim pemain dan attacker setelah pergantian sisi', result.teams,
        { player: side === 'attack' ? 'ember' : 'warden', attacker, contextAttacker: attacker, swapped });
      equal('Tepat satu anchor defender untuk setiap site', result.assignment,
        [{ site: 'A', team: defender }, { site: 'B', team: defender }]);
      equal('Attacker tidak menjadi anchor', result.attackersWithAnchor, []);
      equal('Kedua anchor berjalan dari spawn sampai holding', result.arrived, true,
        { ticks: result.travel.ticks, perjalanan: result.travel.traces });
      for (const site of ['A', 'B']) {
        const bot = result.actors.find((actor) => actor.siteId === site);
        const travel = traceFor(result.travel, bot?.id);
        const stable = traceFor(result.stable, bot?.id);
        equal(`Anchor ${site} berada dalam radius <0.9`, distanceXZ(bot?.position, HOLD_POINTS[site]) < 0.9,
          true, bot);
        equal(`Perjalanan anchor ${site} bebas collision`, travel?.collisions, 0);
        equal(`Anchor ${site} bergerak fisik dari spawn`, {
          moved: travel?.distance > 2, boundedSteps: travel?.maxStep <= 0.081,
        }, { moved: true, boundedSteps: true }, travel);
        equal(`Anchor ${site} berhenti selama 120 tick`, {
          holdingTicks: stable?.holdingTicks, distance: stable?.distance,
        }, { holdingTicks: 120, distance: 0 });
        equal(`Yaw anchor ${site} terus menatap approach`, Number.isFinite(stable?.maxYawError)
          && stable.maxYawError < 1e-6, true, { galatRadian: stable?.maxYawError, yaw: bot?.yaw });
      }
    }, side);
  }
}

// Kasus sebelumnya meninggalkan combatants kosong, attacker Warden, serta jam yang sudah maju.
test('Runner memulihkan botCtx setelah fixture navigasi', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    return {
      identities: g.botCtx.combatants.length === 10 && g.botCtx.combatants[0] === g.player.state
        && g.bots.roster.every((bot, index) => g.botCtx.combatants[index + 1] === bot)
        && g.botCtx.bots === g.bots.roster && g.botCtx.player === g.player.state
        && g.botCtx.bomb === g.match.state.bomb,
      clock: { now: g.botCtx.now, matchNow: g.match.state.now,
        attacker: g.botCtx.attackerTeam, matchAttacker: g.match.state.attackerTeam },
    };
  });
  equal('Combatants dan referensi konteks dikembalikan', result.identities, true);
  equal('Jam serta tim attacker dikembalikan', result.clock,
    { now: 0, matchNow: 0, attacker: 'ember', matchAttacker: 'ember' });
});

test('Noise tidak membuat anchor holding berkelana', async (page) => {
  const result = await page.evaluate((approaches) => {
    const g = window.testGame;
    const t = window.tactics;
    t.isolateBots();
    const { anchors, arrived } = t.settleAnchors();
    const heardAt = g.botCtx.now;
    g.bots.hear(0, 2, g.match.state.attackerTeam, heardAt);
    const heard = anchors.map((bot) => ({ site: bot.siteId,
      lastSeen: { x: bot.lastSeen.x, z: bot.lastSeen.z }, alerted: bot.alertUntil > heardAt,
    })).sort((a, b) => a.site.localeCompare(b.site));
    const active = t.advanceBots(120, { watch: anchors, face: (bot) => approaches[bot.siteId] });
    t.advanceBots(90, { watch: anchors });
    const expired = anchors.map((bot) => ({ id: bot.id, expired: bot.alertUntil < g.botCtx.now }));
    const after = t.advanceBots(120, { watch: anchors, face: (bot) => approaches[bot.siteId] });
    return { arrived, heard, active, after, expired, actors: anchors.map((bot) => t.actor(bot)) };
  }, APPROACH_POINTS);
  equal('Noise diuji setelah kedua anchor benar-benar holding', result.arrived, true);
  equal('Noise benar-benar memperbarui memori kedua anchor', result.heard,
    ['A', 'B'].map((site) => ({ site, lastSeen: { x: 0, z: 2 }, alerted: true })));
  for (const site of ['A', 'B']) {
    const bot = result.actors.find((actor) => actor.siteId === site);
    const active = traceFor(result.active, bot?.id);
    const after = traceFor(result.after, bot?.id);
    equal(`Noise aktif: anchor ${site} tetap berhenti`, {
      holdingTicks: active?.holdingTicks, distance: active?.distance,
    }, { holdingTicks: 120, distance: 0 });
    equal(`Noise kedaluwarsa: anchor ${site} tetap berhenti`, {
      holdingTicks: after?.holdingTicks, distance: after?.distance,
      expired: result.expired.find((entry) => entry.id === bot?.id)?.expired,
    }, { holdingTicks: 120, distance: 0, expired: true });
    equal(`Noise tidak mengubah sudut hold ${site}`, Number.isFinite(active?.maxYawError)
      && Number.isFinite(after?.maxYawError) && Math.max(active.maxYawError, after.maxYawError) < 1e-6,
    true, { aktif: active?.maxYawError, sesudah: after?.maxYawError });
  }
});

test('Recovery terdekat mengalahkan target lama dan berpindah saat bot mati', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    g.match.state.attackSite = 'B';
    g.bots.resetRound(g.match.state.attackerTeam, g.player.state.team, 'B');
    t.isolateBots();
    const attackers = g.bots.roster.filter((bot) => bot.team === g.match.state.attackerTeam);
    const defender = g.bots.roster.find((bot) => bot.team !== g.match.state.attackerTeam);
    const chosen = attackers[1];
    const next = attackers[0];
    const cover = attackers[3];
    g.player.state.position.set(0, 0, 8);
    next.position.set(0, 0, 12.5);
    chosen.position.set(0, 0, 5.5);
    Object.assign(attackers[2], { alive: false, health: 0 });
    attackers[2].position.set(0, 0, 7.95);
    defender.position.set(0.1, 0, 8);
    cover.position.set(6, 0, 17);
    g.match.pickup(g.player.state);
    g.match.state.bomb.plantProgress = 0.7;
    g.applyDamage(g.player.state, 1000, 'body', defender, { name: 'KESTREL-9' });
    const dropped = { ownerAlive: g.player.state.alive, deaths: g.player.state.deaths, bomb: t.bomb() };
    const oldTarget = { name: 'OLD TARGET', team: defender.team, alive: true, height: 1.76,
      position: chosen.position.clone().set(0, 0, -8) };
    chosen.target = oldTarget;
    chosen.lastSeen.copy(oldTarget.position);
    chosen.lastSeenAt = g.botCtx.now;
    chosen.alertUntil = g.botCtx.now + 60;
    chosen.thinkTimer = 60;
    chosen.path = [{ x: 0, z: 1 }];
    chosen.pathIndex = 0;
    chosen.repathTimer = 60;
    const stale = { combatants: g.botCtx.combatants.length, targetAlive: chosen.target.alive,
      repathTimer: chosen.repathTimer, lastSeen: { x: chosen.lastSeen.x, z: chosen.lastSeen.z } };
    const before = t.actor(chosen);
    const coverRoute = { ...g.map.routes[cover.siteId][cover.slot % 3][cover.routeIndex] };
    t.botTick();
    const first = { actor: t.actor(chosen), recovering: g.bots.roster.filter((bot) => bot.recovering).map((bot) => bot.id),
      cover: t.actor(cover) };
    g.applyDamage(chosen, 1000, 'body', defender, { name: 'KESTREL-9' });
    t.botTick();
    const transfer = { recovering: g.bots.roster.filter((bot) => bot.recovering).map((bot) => bot.id),
      deadRecoverer: chosen.recovering, bomb: t.bomb(), phase: g.match.state.phase };
    g.match.pickup(next);
    next.repathTimer = 60;
    t.botTick();
    return {
      chosenId: chosen.id, nextId: next.id, dropped, stale, before, first, transfer, coverRoute,
      ended: { recovering: g.bots.roster.filter((bot) => bot.recovering).map((bot) => bot.id),
        actor: t.actor(next), bomb: t.bomb() },
    };
  });
  equal('Kematian carrier pemain menjatuhkan core dan mereset progress', {
    alive: result.dropped.ownerAlive, deaths: result.dropped.deaths,
    state: result.dropped.bomb.state, carrier: result.dropped.bomb.carrierId,
    progress: result.dropped.bomb.plantProgress, position: result.dropped.bomb.position,
  }, { alive: false, deaths: 1, state: 'dropped', carrier: null, progress: 0, position: { x: 0, z: 8 } });
  equal('Fixture menyimpan target hidup, memori, dan repath lama', result.stale,
    { combatants: 0, targetAlive: true, repathTimer: 60, lastSeen: { x: 0, z: -8 } });
  equal('Hanya attacker hidup terdekat menjadi recoverer', result.first.recovering, [result.chosenId]);
  equal('Recovery mengganti path lama dan mendekati core', {
    replanned: result.first.actor.repathTimer <= 2,
    coreGoal: distanceXZ(result.first.actor.pathGoal, { x: 0, z: 8 }) < 0.9,
    closer: distanceXZ(result.first.actor.position, { x: 0, z: 8 })
      < distanceXZ(result.before.position, { x: 0, z: 8 }),
  }, { replanned: true, coreGoal: true, closer: true }, result.first.actor);
  equal('Attacker lain tetap mengikuti route/cover', {
    recovering: result.first.cover.recovering,
    routeGoal: distanceXZ(result.first.cover.pathGoal, result.coverRoute) < 0.9,
  }, { recovering: false, routeGoal: true }, result.first.cover);
  equal('Recovery berpindah dan flag recoverer mati dibersihkan', {
    recovering: result.transfer.recovering, deadRecoverer: result.transfer.deadRecoverer,
  }, { recovering: [result.nextId], deadRecoverer: false });
  equal('Kematian non-carrier mempertahankan core dropped', {
    state: result.transfer.bomb.state, carrier: result.transfer.bomb.carrierId, phase: result.transfer.phase,
  }, { state: 'dropped', carrier: null, phase: 'live' });
  equal('Pickup mengakhiri recovery dan mereset repath kembali', {
    recovering: result.ended.recovering, replanned: result.ended.actor.repathTimer <= 2,
    state: result.ended.bomb.state, carrier: result.ended.bomb.carrierId,
  }, { recovering: [], replanned: true, state: 'carried', carrier: result.nextId });
});

test('Picker memilih bot terdekat, bukan urutan roster', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    g.match.state.attackSite = 'B';
    g.bots.resetRound(g.match.state.attackerTeam, g.player.state.team, 'A');
    t.isolateBots();
    const attackers = g.bots.roster.filter((bot) => bot.team === g.match.state.attackerTeam);
    const first = attackers[0];
    const closest = attackers[1];
    const dead = attackers[2];
    const defender = g.bots.roster.find((bot) => bot.team !== g.match.state.attackerTeam);
    first.position.set(1.1, 0, 8);
    closest.position.set(0.35, 0, 8);
    Object.assign(dead, { alive: false, health: 0 });
    dead.position.set(0.1, 0, 8);
    defender.position.set(0.05, 0, 8);
    closest.path = [{ x: 0, z: 18.5 }];
    closest.pathIndex = 0;
    closest.repathTimer = 17;
    g.match.pickup(g.player.state);
    g.match.state.bomb.plantProgress = 0.71;
    g.match.dropBomb(0, 8);
    const dropProgress = g.match.state.bomb.plantProgress;
    g.match.state.bomb.plantProgress = 0.43;
    const beforeFirst = t.actor(first);
    g.pickupBombIfDropped();
    return {
      closestId: closest.id, dropProgress, bomb: t.bomb(), closest: t.actor(closest),
      beforeFirst, afterFirst: t.actor(first), routeLength: g.map.routes.B[closest.slot % 3].length,
      distances: [defender, dead, closest, first].map((bot) => Math.hypot(bot.position.x, bot.position.z - 8)),
    };
  });
  equal('Drop menghapus progress plant parsial', result.dropProgress, 0);
  equal('Carrier adalah bot hidup terdekat', result.bomb.carrierId, result.closestId);
  equal('Carrier baru memakai site/route langsung dan progress bersih', {
    site: result.closest.siteId, route: result.closest.routeIndex,
    repath: result.closest.repathTimer, progress: result.bomb.plantProgress,
  }, { site: 'B', route: result.routeLength, repath: 0, progress: 0 });
  equal('Bot eligible yang lebih jauh tidak ikut diubah', result.afterFirst, result.beforeFirst);
  equal('Fixture tanpa tie, defender dan bot mati lebih dekat', result.distances, [0.05, 0.1, 0.35, 1.1]);
  equal('Pickup terdekat berada dalam radius <1.3', result.distances[2] < 1.3, true);
});

test('Defender, attacker mati, dan batas 1.3 tidak dapat pickup', async (page) => {
  const result = await page.evaluate(() => {
    const g = window.testGame;
    const t = window.tactics;
    t.isolateBots();
    g.match.state.attackSite = 'B';
    const attackers = g.bots.roster.filter((bot) => bot.team === g.match.state.attackerTeam);
    const defender = g.bots.roster.find((bot) => bot.team !== g.match.state.attackerTeam);
    Object.assign(attackers[0], { alive: false, health: 0 });
    attackers[0].position.set(0.1, 0, 8);
    defender.position.set(0.05, 0, 8);
    g.player.state.position.set(0, 0, 8);
    g.match.pickup(attackers[1]);
    g.match.dropBomb(0, 8);
    g.pickupBombIfDropped();
    const ineligible = t.bomb();
    attackers[1].position.set(1.3, 0, 8);
    g.pickupBombIfDropped();
    const boundary = t.bomb();
    attackers[1].position.set(1.29, 0, 8);
    g.pickupBombIfDropped();
    return { ineligible, boundary, picked: t.bomb(), actor: t.actor(attackers[1]),
      expectedId: attackers[1].id, routeLength: g.map.routes.B[attackers[1].slot % 3].length };
  });
  equal('Player defender, bot defender, dan attacker mati dilewati',
    { state: result.ineligible.state, carrier: result.ineligible.carrierId }, { state: 'dropped', carrier: null });
  equal('Jarak tepat 1.3 tetap tidak eligible',
    { state: result.boundary.state, carrier: result.boundary.carrierId }, { state: 'dropped', carrier: null });
  equal('Attacker hidup pada 1.29 mengambil core dan menuju site', {
    state: result.picked.state, carrier: result.picked.carrierId,
    site: result.actor.siteId, route: result.actor.routeIndex, repath: result.actor.repathTimer,
  }, { state: 'carried', carrier: result.expectedId, site: 'B', route: result.routeLength, repath: 0 });
}, 'defend');

for (const scenario of [
  { site: 'A', owner: 'player', side: 'attack' },
  { site: 'B', owner: 'bot', side: 'defend' },
]) {
  test(`Carrier ${scenario.owner} mati: recovery dan plant fisik ${scenario.site}`, async (page) => {
    const result = await page.evaluate(({ site, owner }) => {
      const g = window.testGame;
      const t = window.tactics;
      g.match.state.attackSite = site;
      g.bots.resetRound(g.match.state.attackerTeam, g.player.state.team, site);
      t.isolateBots();
      const attackers = g.bots.roster.filter((bot) => bot.team === g.match.state.attackerTeam);
      const chosen = attackers[1];
      const carrier = owner === 'player' ? g.player.state : attackers[0];
      const killer = g.player.state.team !== g.match.state.attackerTeam ? g.player.state
        : g.bots.roster.find((bot) => bot.team !== g.match.state.attackerTeam);
      const x = site === 'A' ? -12 : 12;
      carrier.position.set(x, 0, 1);
      chosen.position.set(x, 0, 4);
      chosen.siteId = site === 'A' ? 'B' : 'A';
      chosen.routeIndex = 0;
      chosen.path = [{ x: 0, z: 18.5 }];
      chosen.pathIndex = 0;
      chosen.repathTimer = 60;
      g.match.pickup(carrier);
      g.match.state.bomb.plantProgress = 0.8;
      g.applyDamage(carrier, 1000, 'body', killer, { name: 'KESTREL-9' });
      const death = { alive: carrier.alive, deaths: carrier.deaths };
      const dropped = t.bomb();
      const start = { distance: Math.hypot(chosen.position.x - x, chosen.position.z - 1),
        inSite: g.map.siteAt(chosen.position.x, chosen.position.z)?.id ?? null };
      let picked = null;
      let planting = null;
      let firstProgress = null;
      let plantFrames = 0;
      const run = t.advanceBots(1800, {
        watch: [chosen], objectives: true,
        beforeObjective() {
          if (!picked && g.match.state.bomb.carrier === chosen) {
            picked = { carrier: t.bomb().carrierId, actor: t.actor(chosen),
              progress: g.match.state.bomb.plantProgress,
              distance: Math.hypot(chosen.position.x - x, chosen.position.z - 1) };
          }
          if (g.match.state.bomb.state === 'carried' && g.match.state.bomb.carrier === chosen
            && chosen.interacting === 'plant') {
            plantFrames += 1;
            planting ??= { interacting: chosen.interacting,
              site: g.map.siteAt(chosen.position.x, chosen.position.z)?.id ?? null, siteId: chosen.siteId };
          }
        },
        observe() {
          if (plantFrames === 1 && firstProgress === null) firstProgress = g.match.state.bomb.plantProgress;
        },
        until: () => g.match.state.bomb.state === 'planted',
      });
      return {
        chosenId: chosen.id, death, dropped, start, picked, planting, firstProgress, plantFrames, run,
        bomb: t.bomb(), actor: t.actor(chosen), match: t.match(),
        physicalSite: g.map.siteAt(chosen.position.x, chosen.position.z)?.id ?? null,
        routeLength: g.map.routes[site][chosen.slot % 3].length,
      };
    }, scenario);
    equal('Carrier benar-benar terbunuh lewat applyDamage', result.death, { alive: false, deaths: 1 });
    equal('Core jatuh pada posisi kematian dengan progress nol', {
      state: result.dropped.state, carrier: result.dropped.carrierId,
      progress: result.dropped.plantProgress, position: result.dropped.position,
    }, { state: 'dropped', carrier: null, progress: 0,
      position: { x: scenario.site === 'A' ? -12 : 12, z: 1 } });
    equal('Pengganti mulai di luar pickup radius dan di luar site', result.start, { distance: 3, inSite: null });
    equal('Pengganti mengambil core melalui pickup nyata', result.picked?.carrier, result.chosenId);
    equal('Pickup mengoreksi site lama, route spawn, dan repath', {
      site: result.picked?.actor.siteId, route: result.picked?.actor.routeIndex,
      repath: result.picked?.actor.repathTimer, progress: result.picked?.progress,
    }, { site: scenario.site, route: result.routeLength, repath: 0, progress: 0 });
    equal('Pengganti berjalan sampai radius pickup <1.3', result.picked?.distance < 1.3, true, result.picked?.distance);
    const trace = traceFor(result.run, result.chosenId);
    equal('Recovery dan perjalanan plant bebas collision', trace?.collisions, 0);
    equal('Tidak ada teleport selama recovery/plant', trace?.maxStep <= 0.081, true, trace);
    equal('Pengganti menempuh lebih dari jarak recovery awal', trace?.distance > 3, true, trace?.distance);
    equal('Plant mulai hanya setelah tiba secara fisik di site', result.planting,
      { interacting: 'plant', site: scenario.site, siteId: scenario.site });
    equal('Plant menunjukkan progress parsial nyata', result.firstProgress > 0 && result.firstProgress < 1,
      true, result.firstProgress);
    equal('Plant penuh memerlukan 3.2 detik, toleransi satu tick', result.plantFrames >= 192 && result.plantFrames <= 193,
      true, { tickPlant: result.plantFrames, tickTotal: result.run.ticks });
    equal('Core terpasang di site tujuan dengan carrier kosong', {
      state: result.bomb.state, site: result.bomb.siteId,
      carrier: result.bomb.carrierId, progress: result.bomb.plantProgress,
    }, { state: 'planted', site: scenario.site, carrier: null, progress: 0 });
    equal('Posisi core sama dengan posisi plant fisik bot', {
      position: result.bomb.position, site: result.physicalSite,
    }, { position: { x: result.actor.position.x, z: result.actor.position.z }, site: scenario.site });
    equal('Plant tidak langsung mengakhiri ronde', { phase: result.match.phase, scores: result.match.scores },
      { phase: 'live', scores: { ember: 0, warden: 0 } });
  }, scenario.side);
}

for (const scenario of [
  { site: 'A', kit: true, side: 'defend' },
  { site: 'B', kit: false, side: 'attack' },
]) {
  test(`Anchor retake lintas site ${scenario.site} dan defuse ${scenario.kit ? 'kit' : 'tanpa kit'}`, async (page) => {
    const result = await page.evaluate(({ site, kit }) => {
      const g = window.testGame;
      const t = window.tactics;
      t.isolateBots();
      const { anchors } = t.settleAnchors();
      const ownedSite = site === 'A' ? 'B' : 'A';
      const chosen = anchors.find((bot) => bot.siteId === ownedSite);
      if (!chosen) throw new Error(`Anchor ${ownedSite} tidak tersedia untuk retake`);
      const started = t.actor(chosen);
      // Satu defender tersisa: defuser lain tidak dapat mempercepat pengukuran kit/no-kit.
      for (const bot of g.bots.roster) {
        if (bot.team !== g.match.state.attackerTeam && bot !== chosen) bot.alive = false;
      }
      chosen.hasKit = kit;
      const moneyBefore = chosen.money;
      const planter = g.bots.roster.find((bot) => bot.alive && bot.team === g.match.state.attackerTeam);
      const core = g.map.sites[site];
      g.match.plant(planter, core.x, core.z, site);
      let firstDefuse = null;
      let firstBefore = null;
      let sample = null;
      let lastPartial = null;
      let defuseFrames = 0;
      const expectedTicks = kit ? 300 : 600;
      const run = t.advanceBots(1800, {
        watch: [chosen], objectives: true,
        beforeObjective() {
          if (g.match.state.bomb.state === 'planted' && chosen.interacting === 'defuse') {
            defuseFrames += 1;
            if (!firstDefuse) {
              firstDefuse = { actor: t.actor(chosen),
                distance: Math.hypot(chosen.position.x - core.x, chosen.position.z - core.z),
                inSite: g.map.siteAt(chosen.position.x, chosen.position.z)?.id ?? null };
              firstBefore = g.match.state.bomb.defuseProgress;
            }
          }
        },
        observe() {
          if (defuseFrames === 120) sample = g.match.state.bomb.defuseProgress;
          if (defuseFrames === expectedTicks - 1) {
            lastPartial = { state: g.match.state.bomb.state, progress: g.match.state.bomb.defuseProgress };
          }
        },
        until: () => g.match.state.bomb.state === 'defused',
      });
      return {
        chosenId: chosen.id, ownedSite, started, firstDefuse, firstBefore, sample, lastPartial,
        defuseFrames, run, bomb: t.bomb(), match: t.match(), reward: chosen.money - moneyBefore,
      };
    }, scenario);
    equal('Retake dimulai dari anchor holding di site lain', {
      anchor: result.started.anchor, holding: result.started.holding, site: result.started.siteId,
    }, { anchor: true, holding: true, site: scenario.site === 'A' ? 'B' : 'A' });
    equal('Core planted mengalahkan tugas hold dan memicu defuse', {
      anchor: result.firstDefuse?.actor.anchor, holding: result.firstDefuse?.actor.holding,
      interaction: result.firstDefuse?.actor.interacting, inSite: result.firstDefuse?.inSite,
      inRange: result.firstDefuse?.distance < 1.7,
    }, { anchor: true, holding: false, interaction: 'defuse', inSite: scenario.site, inRange: true });
    const trace = traceFor(result.run, result.chosenId);
    equal('Retake lintas site bebas collision', trace?.collisions, 0);
    equal('Retake memakai langkah fisik tanpa teleport', trace?.maxStep <= 0.081, true, trace);
    equal('Anchor benar-benar berjalan lintas site', trace?.distance > 10, true, trace?.distance);
    equal('Pengukuran defuse mulai dari progress nol', result.firstBefore, 0);
    equal('Progress defuse setelah 120 tick mengikuti kit', Number.isFinite(result.sample)
      && Math.abs(result.sample - (scenario.kit ? 0.4 : 0.2)) < 1e-6,
    true, { aktual: result.sample, harapan: scenario.kit ? 0.4 : 0.2 });
    equal('Defuse tidak selesai satu tick lebih awal', result.lastPartial?.state === 'planted'
      && result.lastPartial.progress < 1, true, result.lastPartial);
    const expectedTicks = scenario.kit ? 300 : 600;
    equal(`Defuse memerlukan ${scenario.kit ? 5 : 10} detik penuh`,
      result.defuseFrames >= expectedTicks && result.defuseFrames <= expectedTicks + 1,
      true, { tickDefuse: result.defuseFrames, tickTotal: result.run.ticks });
    equal('Defuser nyata menyelesaikan core', {
      state: result.bomb.state, defuser: result.bomb.defuserId, progress: result.bomb.defuseProgress,
    }, { state: 'defused', defuser: result.chosenId, progress: 1 });
    equal('Defuse memenangkan ronde defender', {
      phase: result.match.phase, winner: result.match.roundWinner, scores: result.match.scores,
    }, { phase: 'roundEnd', winner: 'warden', scores: { ember: 0, warden: 1 } });
    equal('Defuser memperoleh reward $300 dan payout kemenangan $3250', result.reward, 3550);
  }, scenario.side);
}

async function main() {
  let server;
  let browser;
  let serverLog = '';
  let mainInjections = 0;
  const issues = { page: [], console: [], requests: [], outside: [], failedRequests: [], http: [], route: [], server: [] };
  try {
    const { chromium } = await import(PLAYWRIGHT_MODULE);
    const source = await readFile(new URL('../game/src/main.js', import.meta.url), 'utf8');
    server = spawn('node', ['serve.ts', '--port', String(PORT)], {
      cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collectLog = (chunk) => { serverLog = (serverLog + chunk.toString()).slice(-16_384); };
    server.stdout.on('data', collectLog);
    server.stderr.on('data', collectLog);
    server.on('error', (error) => issues.server.push(error.message));
    await waitForServer(server);
    browser = await chromium.launch({
      executablePath: CHROME_BIN, headless: true, timeout: TIMEOUT.launch,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block',
    });
    context.on('page', (page) => {
      page.on('pageerror', (error) => issues.page.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') issues.console.push({ text: message.text(), location: message.location() });
      });
    });
    context.on('request', (request) => {
      issues.requests.push(request.url());
      if (new URL(request.url()).origin !== ORIGIN) issues.outside.push(request.url());
    });
    context.on('requestfailed', (request) => issues.failedRequests.push({
      url: request.url(), error: request.failure()?.errorText,
    }));
    context.on('response', (response) => {
      if (response.status() >= 400) issues.http.push({ url: response.url(), status: response.status() });
    });
    await context.route('**/*', async (route) => {
      try {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) {
          await route.abort('blockedbyclient');
        } else if (url.pathname === '/src/main.js') {
          mainInjections += 1;
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: source + EXPOSE_MAIN });
        } else {
          await route.continue();
        }
      } catch (error) {
        issues.route.push(error.message);
        await route.abort('failed').catch(() => {});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT.page);
    page.setDefaultNavigationTimeout(TIMEOUT.page);
    const response = await page.goto(`${ORIGIN}/?shot=menu&seed=3`, { waitUntil: 'load', timeout: TIMEOUT.page });
    equal('Halaman server berhasil dimuat', response?.status() ?? null, 200);
    await page.waitForFunction(() => Boolean(window.testGame && window.__shotReady), null, { timeout: TIMEOUT.page });
    await timed(installHelpers(page), TIMEOUT.page, 'Pemasangan helper browser');
    console.log(`Harness taktik: ${cases.length} kasus; server ${ORIGIN}; seed=3.`);
    for (const entry of cases) {
      currentCase = entry.name;
      counts.cases += 1;
      const before = { ...counts };
      try {
        await timed((async () => {
          await page.evaluate((side) => {
            const g = window.testGame;
            g.input.state.keys.clear();
            g.input.state.firing = false;
            g.input.state.locked = false;
            g.input.takeLook();
            g.input.clearPressed();
            g.restartMatch(side);
            window.tactics.restoreBotContext();
          }, entry.side);
          await entry.run(page);
        })(), TIMEOUT.case, entry.name);
      } catch (error) {
        failure('Eksekusi kasus', error);
        if (error.code === 'TACTICS_TIMEOUT' || page.isClosed()) break;
      }
      console.log(`${counts.failed === before.failed ? 'PASS' : 'FAIL'} kasus: ${entry.name} (${counts.assertions - before.assertions} asersi)`);
    }
  } catch (error) {
    failure('Persiapan harness', error);
    if (serverLog.trim()) console.error(`Log server: ${serverLog.trim()}`);
  } finally {
    currentCase = 'Diagnostik';
    if (browser) {
      equal('Sumber main diinstrumentasi sekali', mainInjections, 1);
      equal('Semua request berasal dari server localhost', issues.outside, []);
      equal('Ada request halaman dan modul lokal', issues.requests.length > 0, true, { jumlah: issues.requests.length });
      equal('Tidak ada pageerror', issues.page, []);
      equal('Tidak ada console error', issues.console, []);
      equal('Tidak ada request gagal', issues.failedRequests, []);
      equal('Tidak ada respons HTTP error', issues.http, []);
      equal('Routing berhasil', issues.route, []);
    }
    if (server?.pid) {
      equal('Server aktif sampai pengujian selesai', { code: server.exitCode, signal: server.signalCode }, { code: null, signal: null });
    }
    equal('Tidak ada error proses server', issues.server, []);
    currentCase = 'Pembersihan';
    try {
      if (browser) await timed(browser.close(), TIMEOUT.cleanup, 'Penutupan browser');
    } catch (error) {
      failure('Penutupan browser', error);
    } finally {
      try { await stopServer(server); } catch (error) { failure('Penghentian server', error); }
    }
  }
  console.log(`HASIL: ${counts.passed}/${counts.assertions} assertion PASS; ${counts.failed} FAIL; ${counts.cases}/${cases.length} kasus dijalankan.`);
  process.exitCode = counts.failed === 0 ? 0 : 1;
}

await main();
