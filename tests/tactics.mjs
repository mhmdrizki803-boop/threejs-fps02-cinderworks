#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const PORT = 8188;
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
  if (status === 'PASS') console.log(line);
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
  await page.evaluate(() => {
    const g = window.testGame;
    const teams = ['ember', 'warden'];
    window.tactics = {
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
    await installHelpers(page);
    console.log(`Harness taktik: ${cases.length} kasus; server ${ORIGIN}; seed=3.`);
    for (const entry of cases) {
      currentCase = entry.name;
      counts.cases += 1;
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
          }, entry.side);
          await entry.run(page);
        })(), TIMEOUT.case, entry.name);
      } catch (error) {
        failure('Eksekusi kasus', error);
        if (error.code === 'TACTICS_TIMEOUT' || page.isClosed()) break;
      }
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
