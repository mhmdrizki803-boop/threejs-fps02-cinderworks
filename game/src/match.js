export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const BOMB_TIME = 40;
export const HALF_ROUNDS = 6;
export const WIN_ROUNDS = 7;
export const MAX_MONEY = 16000;
export function createMatch() {
const state = {
phase: 'menu',
phaseTimer: 0,
round: 1,
roundTimer: ROUND_TIME,
buyTimer: BUY_TIME,
attackerTeam: 'ember',
playerTeam: 'ember',
scores: { ember: 0, warden: 0 },
playerMoney: 800,
lossStreak: { ember: 0, warden: 0 },
roundWinner: null,
matchWinner: null,
swapped: false,
now: 0,
banner: { text: '', sub: '', time: 0 },
feed: [],
bomb: {
state: 'carried', carrier: null, position: { x: 0, z: -4 }, timer: BOMB_TIME,
plantProgress: 0, defuseProgress: 0, defuser: null, beepTimer: 0,
},
};
function setBanner(text, sub, time = 3) {
state.banner.text = text;
state.banner.sub = sub;
state.banner.time = time;
}
function sideOf(team) {
return team === state.attackerTeam ? 'attack' : 'defend';
}
state.sideOf = sideOf;
function isBuyPhase() {
return state.phase === 'buy';
}
function startMatch(ctx) {
state.phase = 'buy';
state.phaseTimer = 0;
state.round = 1;
state.roundTimer = ROUND_TIME;
state.buyTimer = BUY_TIME;
state.attackerTeam = 'ember';
state.scores.ember = 0;
state.scores.warden = 0;
state.playerMoney = 800;
state.lossStreak.ember = 0;
state.lossStreak.warden = 0;
state.roundWinner = null;
state.matchWinner = null;
state.swapped = false;
state.now = 0;
state.feed.length = 0;
state.bomb.state = 'carried';
state.bomb.carrier = null;
state.bomb.timer = BOMB_TIME;
state.bomb.plantProgress = 0;
state.bomb.defuseProgress = 0;
setBanner('ROUND 1', 'BUY PHASE', 3.2);
ctx.onRoundStart();
}
function beginRound(ctx) {
state.phase = 'buy';
state.phaseTimer = 0;
state.roundTimer = ROUND_TIME;
state.buyTimer = BUY_TIME;
state.roundWinner = null;
state.bomb.state = 'carried';
state.bomb.carrier = null;
state.bomb.timer = BOMB_TIME;
state.bomb.plantProgress = 0;
state.bomb.defuseProgress = 0;
state.bomb.defuser = null;
setBanner(`ROUND ${state.round}`, state.sideOf(state.playerTeam) === 'attack' ? 'EMBER ATTACKS' : 'EMBER DEFENDS', 2.6);
ctx.onRoundStart();
}
function finishRound(winner, reason, ctx) {
if (state.phase !== 'live') return;
const loser = winner === 'ember' ? 'warden' : 'ember';
const winBonus = 3250;
const lossBonus = 1400 + 500 * Math.min(state.lossStreak[loser], 4);
state.scores[winner] += 1;
state.lossStreak[winner] = 0;
state.lossStreak[loser] += 1;
state.playerMoney = Math.min(MAX_MONEY, state.playerMoney + (state.playerTeam === winner ? winBonus : lossBonus));
for (const bot of ctx.bots) {
bot.money = Math.min(MAX_MONEY, bot.money + (bot.team === winner ? winBonus : lossBonus));
}
state.phase = state.scores[winner] >= WIN_ROUNDS ? 'roundEnd' : 'roundEnd';
state.phaseTimer = 5.0;
state.roundWinner = winner;
if (state.scores[winner] >= WIN_ROUNDS) state.matchWinner = winner;
setBanner(winner === 'ember' ? 'EMBER WINS THE ROUND' : 'WARDEN WINS THE ROUND', reason, 5.0);
ctx.onRoundEnd?.(winner, reason);
}
function addKillReward(entity, amount) {
if (entity === null) return;
if (entity.isPlayer) state.playerMoney = Math.min(MAX_MONEY, state.playerMoney + amount);
else if (entity.money !== undefined) entity.money = Math.min(MAX_MONEY, entity.money + amount);
}
function plant(planter, x, z) {
state.bomb.state = 'planted';
state.bomb.carrier = null;
state.bomb.position.x = x;
state.bomb.position.z = z;
state.bomb.timer = BOMB_TIME;
state.bomb.plantProgress = 0;
state.bomb.defuseProgress = 0;
state.bomb.beepTimer = 0;
addKillReward(planter, 300);
setBanner('PULSE CORE ARMED', 'DEFEND THE SITE', 3);
}
function defused(by) {
state.bomb.state = 'defused';
addKillReward(by, 300);
}
function dropBomb(x, z) {
if (state.bomb.state !== 'carried') return;
state.bomb.state = 'dropped';
state.bomb.carrier = null;
state.bomb.position.x = x;
state.bomb.position.z = z;
}
function pickup(carrier) {
state.bomb.state = 'carried';
state.bomb.carrier = carrier;
}
function step(dt, ctx) {
state.now += dt;
if (state.banner.time > 0) state.banner.time = Math.max(0, state.banner.time - dt);
if (state.phase === 'buy') {
state.buyTimer = Math.max(0, state.buyTimer - dt);
if (state.buyTimer === 0) {
state.phase = 'live';
state.roundTimer = ROUND_TIME;
state.phaseTimer = 0;
setBanner(`ROUND ${state.round}`, state.sideOf(state.playerTeam) === 'attack' ? 'PULSE SITE A' : 'DEFEND THE SITE', 2.2);
ctx.onLive?.();
}
} else if (state.phase === 'live') {
if (state.bomb.state === 'planted') {
state.bomb.timer = Math.max(0, state.bomb.timer - dt);
if (state.bomb.timer === 0) ctx.onBombExplode?.();
} else {
state.roundTimer = Math.max(0, state.roundTimer - dt);
if (state.roundTimer === 0) ctx.onTimeExpired?.();
}
} else if (state.phase === 'roundEnd') {
state.phaseTimer = Math.max(0, state.phaseTimer - dt);
if (state.phaseTimer === 0) {
if (state.matchWinner) {
state.phase = 'matchEnd';
setBanner(state.matchWinner === 'ember' ? 'EMBER WINS THE MATCH' : 'WARDEN WINS THE MATCH', `${state.scores.ember} : ${state.scores.warden}`, 999);
ctx.onMatchEnd?.(state.matchWinner);
} else if (!state.swapped && state.round === HALF_ROUNDS) {
state.phase = 'halftime';
state.phaseTimer = 4.5;
setBanner('HALF TIME', 'SIDES SWAP', 4.5);
} else {
state.round += 1;
beginRound(ctx);
}
}
} else if (state.phase === 'halftime') {
state.phaseTimer = Math.max(0, state.phaseTimer - dt);
if (state.phaseTimer === 0) {
state.swapped = true;
state.attackerTeam = state.attackerTeam === 'ember' ? 'warden' : 'ember';
state.playerMoney = 800;
state.lossStreak.ember = 0;
state.lossStreak.warden = 0;
for (const bot of ctx.bots) bot.money = 800;
ctx.onSideSwap?.();
state.round += 1;
beginRound(ctx);
}
}
}
return {
state,
startMatch,
finishRound,
plant,
defused,
dropBomb,
pickup,
addKillReward,
sideOf,
isBuyPhase,
step,
};
}
