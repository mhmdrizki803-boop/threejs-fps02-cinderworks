import * as THREE from 'three';
import { PALETTE, otherTeam } from './palette.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createBotSystem } from './bots.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createInput } from './input.js';
import {
createGun, stepGun, gunReady, gunFire, gunReload, gunSpread, gunRefill,
createViewModel, BUY_LIST,
} from './weapon.js';
import { castShot, damageFor, fragDamage, spreadDirection } from './combat.js';
const FIXED_STEP = 1 / 60;
const GRENADE_DEFS = {
frag: { name: 'SHARD', fuse: 1.85, color: PALETTE.hazard, speed: 15, up: 3.4 },
flash: { name: 'DAZZLER', fuse: 1.5, color: '#eef6ff', speed: 16, up: 3.1 },
smoke: { name: 'VEIL', fuse: 1.35, color: '#9aa5aa', speed: 15, up: 3.2 },
};
const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '0', 10) || 1;
function mulberry32(initial) {
let a = initial | 0;
return function random() {
a = (a + 0x6d2b79f5) | 0;
let t = Math.imul(a ^ (a >>> 15), 1 | a);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
const rng = mulberry32(shotMode ? seed : (Date.now() & 0x7fffffff) || 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);
const map = createMap(scene);
const effects = createEffects(scene);
const audio = createAudio();
const player = createPlayer(map.colliders);
player.state.isPlayer = true;
player.state.name = 'YOU';
const bots = createBotSystem(scene, map, rng);
const match = createMatch();
const hud = createHud(map);
const input = createInput(renderer.domElement, onLockChange);
const view = createViewModel(camera);
const combatants = [player.state, ...bots.roster];
const previousPositions = combatants.map(entity => entity.position.clone());
let previousEye = player.state.eye;
const heldGrenades = {};
for (const [type, def] of Object.entries(GRENADE_DEFS)) {
const group = new THREE.Group();
const material = new THREE.MeshStandardMaterial({
color: new THREE.Color(def.color), emissive: new THREE.Color(def.color),
emissiveIntensity: type === 'flash' ? 0.55 : 0.18, roughness: 0.48, metalness: 0.32,
});
const mesh = type === 'frag'
? new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), material)
: new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.2, 10), material);
group.add(mesh);
const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.035), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.shadow), roughness: 0.8 }));
band.position.y = 0.02;
group.add(band);
group.position.set(0.33, -0.23, -0.52);
group.rotation.set(0.1, 0.2, 0.15);
group.visible = false;
camera.add(group);
heldGrenades[type] = group;
}
const loadout = { primary: null, primaryId: null, slot: 'pistol', grenades: { frag: 0, flash: 0, smoke: 0 }, kit: false };
const pistol = createGun('kestrel');
let activeGun = pistol;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
const stats = { frames: 0, since: lastTime };
let footMoved = 0;
let bombBeep = 0;
let shake = 0;
let boardTick = 0;
let buyTick = 0;
let grenadeSlot = null;
const shotOrigin = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();
const tempPoint = new THREE.Vector3();
const grenades = [];
const radarData = { player: player.state, bots: bots.roster, bomb: match.state.bomb };
function syncGunHud() {
hud.setAmmo(activeGun.mag, activeGun.reserve, activeGun.def.name, activeGun.mag === 0, activeGun.reloadLeft > 0);
hud.setGrenades(loadout.grenades, grenadeSlot);
}
function equipGun() {
activeGun = loadout.slot === 'primary' && loadout.primary ? loadout.primary : pistol;
view.setActive(activeGun.id);
syncGunHud();
}
function cancelGrenade() {
grenadeSlot = null;
for (const group of Object.values(heldGrenades)) group.visible = false;
view.setHidden(false);
view.setActive(activeGun.id);
hud.setGrenades(loadout.grenades, grenadeSlot);
hud.setGrenadeHint('');
}
function switchSlot(slot) {
if (slot === 'primary' && !loadout.primary) return;
cancelGrenade();
if (loadout.slot === slot) return;
loadout.slot = slot;
equipGun();
}
function selectGrenade(type) {
if (!player.state.alive || match.state.phase !== 'live') return;
if ((loadout.grenades[type] ?? 0) <= 0) {
if (!shotMode) audio.deny();
hud.setGrenadeHint(`${GRENADE_DEFS[type].name} EMPTY`);
return;
}
if (grenadeSlot === type) {
cancelGrenade();
return;
}
grenadeSlot = type;
view.setHidden(true);
for (const [key, group] of Object.entries(heldGrenades)) group.visible = key === type;
hud.setGrenades(loadout.grenades, grenadeSlot);
hud.setGrenadeHint(`${GRENADE_DEFS[type].name} SELECTED — LMB THROW`);
}
function syncCamera() {
const s = player.state;
camera.position.set(s.position.x, s.position.y + s.eye, s.position.z);
camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
if (shake > 0) {
camera.rotation.x += (rng() * 2 - 1) * shake;
camera.rotation.y += (rng() * 2 - 1) * shake;
}
}
function aimAngles(x, y, z) {
const s = player.state;
const ex = s.position.x;
const ey = s.position.y + s.eye;
const ez = s.position.z;
const dx = x - ex;
const dz = z - ez;
s.yaw = Math.atan2(-dx, -dz);
s.pitch = Math.atan2(y - ey, Math.hypot(dx, dz));
}
function shoot() {
const s = player.state;
const gun = activeGun;
if (!gunReady(gun)) {
if (gun.mag === 0 && gun.reloadLeft === 0) gunReload(gun);
return;
}
const speed = Math.hypot(s.velocity.x, s.velocity.z);
const spread = shotMode ? 0 : gunSpread(gun, speed, s.crouching);
const kick = gunFire(gun);
shotOrigin.set(s.position.x, s.position.y + s.eye, s.position.z);
shotDir.set(-Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch));
if (spread > 0) spreadDirection(shotDir, spread, rng, shotDir);
const hit = castShot(shotOrigin, shotDir, 130, s.team, combatants, map);
muzzleWorld.copy(shotOrigin).addScaledVector(shotDir, 0.9);
muzzleWorld.x += Math.cos(s.yaw) * 0.22;
muzzleWorld.z += -Math.sin(s.yaw) * 0.22;
muzzleWorld.y -= 0.14;
effects.spawnTracer(muzzleWorld, hit.point, PALETTE.hazard);
if (hit.kind === 'entity') {
const amount = damageFor(gun.def, hit.distance, hit.part);
applyDamage(hit.entity, amount, hit.part, s, gun.def);
effects.blood(hit.point, shotDir);
hud.hit(hit.part === 'head');
if (!shotMode) audio.hit(hit.part === 'head');
} else if (hit.kind === 'wall') {
effects.impact(hit.point, hit.normal);
}
player.addRecoil(kick[0], kick[1]);
shake = Math.min(0.01, shake + 0.0035);
view.fire();
if (!shotMode) audio.shot(gun.id, 0);
bots.hear(s.position.x, s.position.z, s.team, match.state.now);
syncGunHud();
}
function applyDamage(target, amount, part, attacker, def) {
if (!target || !target.alive) return;
let killed = false;
if (target === player.state) {
const result = player.damage(amount, part);
killed = result.killed;
if (attacker && attacker.position) {
const dx = attacker.position.x - target.position.x;
const dz = attacker.position.z - target.position.z;
const angle = Math.atan2(-dx, -dz) - target.yaw;
hud.damage(angle);
}
hud.setVitals(target.health, target.armor, target.alive);
shake = Math.min(0.045, shake + amount * 0.0007);
if (killed) onPlayerDeath(attacker);
} else {
killed = bots.damage(target, amount, part);
if (killed) {
target.deaths += 1;
if (match.state.bomb.carrier === target) match.dropBomb(target.position.x, target.position.z);
}
}
if (killed) {
if (attacker && attacker !== target) {
if (attacker === player.state) player.state.kills += 1;
else if (attacker.kills !== undefined) attacker.kills += 1;
match.addKillReward(attacker, 300);
}
const victimName = target === player.state ? 'YOU' : target.name;
const killerName = attacker ? (attacker === player.state ? 'YOU' : attacker.name) : (def?.name ?? 'WORLD');
match.state.feed.push({
killer: killerName,
victim: victimName,
weapon: def?.name ?? 'SHARD',
headshot: part === 'head',
killerTeam: attacker ? attacker.team : null,
self: attacker === player.state,
});
if (match.state.feed.length > 8) match.state.feed.shift();
if (!shotMode) audio.flesh();
checkElimination();
}
}
function onPlayerDeath(attacker) {
hud.setDeath(true);
view.state.lowered = true;
if (match.state.bomb.carrier === player.state) match.dropBomb(player.state.position.x, player.state.position.z);
if (attacker && attacker.position) {
const dx = attacker.position.x - player.state.position.x;
const dz = attacker.position.z - player.state.position.z;
hud.damage(Math.atan2(-dx, -dz) - player.state.yaw);
}
}
function aliveCount(team) {
let count = player.state.team === team && player.state.alive ? 1 : 0;
count += bots.aliveCount(team);
return count;
}
let suppressElimination = false;
function checkElimination() {
const state = match.state;
if (state.phase !== 'live' || suppressElimination) return;
if (state.bomb.state === 'planted' && aliveCount(otherTeam(state.attackerTeam)) > 0) return;
if (aliveCount('ember') === 0) match.finishRound('warden', 'EMBER ELIMINATED', matchCtx);
else if (aliveCount('warden') === 0) match.finishRound('ember', 'WARDEN ELIMINATED', matchCtx);
}
function explodeBomb() {
const bomb = match.state.bomb;
if (bomb.state !== 'planted') return;
bomb.state = 'detonated';
tempPoint.set(bomb.position.x, 0.9, bomb.position.z);
effects.explosion(tempPoint);
if (!shotMode) audio.explode();
const def = { name: 'PULSE CORE' };
suppressElimination = true;
for (const entity of combatants) {
if (!entity.alive) continue;
const distance = Math.hypot(entity.position.x - bomb.position.x, entity.position.z - bomb.position.z);
if (distance > 10) continue;
applyDamage(entity, 30 + 150 * (1 - distance / 10), 'body', null, def);
}
suppressElimination = false;
shake = Math.min(0.08, shake + 0.05);
if (match.state.phase === 'live') match.finishRound(match.state.attackerTeam, 'PULSE CORE DETONATED', matchCtx);
}
function throwGrenade(type) {
if ((loadout.grenades[type] ?? 0) <= 0 || !player.state.alive) return;
loadout.grenades[type] -= 1;
const s = player.state;
const def = GRENADE_DEFS[type];
const material = new THREE.MeshStandardMaterial({
color: new THREE.Color(def.color), emissive: new THREE.Color(def.color),
emissiveIntensity: type === 'flash' ? 0.8 : 0.35, roughness: 0.45, metalness: 0.35,
});
const mesh = type === 'frag'
? new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), material)
: new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.21, 10), material);
mesh.position.set(s.position.x, s.position.y + s.eye - 0.1, s.position.z);
const dir = new THREE.Vector3(-Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch));
const velocity = dir.multiplyScalar(def.speed);
velocity.y += def.up;
scene.add(mesh);
grenades.push({ type, mesh, velocity, fuse: def.fuse, owner: s });
if (!shotMode) audio.beep(type === 'flash' ? 900 : 560);
cancelGrenade();
hud.setObjective(objectiveText());
}
function updateGrenades(dt) {
for (let i = grenades.length - 1; i >= 0; i -= 1) {
const grenade = grenades[i];
grenade.fuse -= dt;
grenade.velocity.y -= 19 * dt;
const next = tempPoint.copy(grenade.mesh.position).addScaledVector(grenade.velocity, dt);
if (next.y < 0.12) {
next.y = 0.12;
grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.42;
grenade.velocity.x *= 0.72;
grenade.velocity.z *= 0.72;
}
if (map.isSolid(next.x, next.z)) {
grenade.velocity.x *= -0.45;
grenade.velocity.z *= -0.45;
} else {
grenade.mesh.position.copy(next);
}
grenade.mesh.rotation.x += dt * 9;
grenade.mesh.rotation.z += dt * 7;
if (grenade.fuse > 0) continue;
const position = grenade.mesh.position.clone();
scene.remove(grenade.mesh);
grenade.mesh.geometry.dispose();
grenade.mesh.material.dispose();
if (grenade.type === 'frag') {
effects.explosion(position);
if (!shotMode) audio.explode();
for (const entity of combatants) {
if (!entity.alive) continue;
const distance = Math.hypot(entity.position.x - position.x, entity.position.y + (entity.height ?? 1.76) * 0.5 - position.y, entity.position.z - position.z);
if (distance >= 7.5 || !map.lineOfSight(position.x, position.z, entity.position.x, entity.position.z)) continue;
applyDamage(entity, fragDamage(distance), 'body', grenade.owner === entity ? null : grenade.owner, { name: GRENADE_DEFS.frag.name });
}
} else if (grenade.type === 'flash') {
effects.flashBurst(position);
if (!shotMode) audio.beep(1500);
const playerDistance = Math.hypot(player.state.position.x - position.x, player.state.position.z - position.z);
if (playerDistance < 18 && map.lineOfSight(position.x, position.z, player.state.position.x, player.state.position.z)) {
hud.flash(Math.max(0.16, 1 - playerDistance / 20));
}
for (const bot of bots.roster) {
if (!bot.alive) continue;
const distance = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
if (distance > 18 || !map.lineOfSight(position.x, position.z, bot.position.x, bot.position.z)) continue;
const dx = position.x - bot.position.x;
const dz = position.z - bot.position.z;
const facing = (-Math.sin(bot.yaw) * dx - Math.cos(bot.yaw) * dz) / (distance || 1);
if (facing > 0.05 || distance < 5.5) {
bot.blindUntil = Math.max(bot.blindUntil, match.state.now + (distance < 6 ? 4.5 : 2.8));
bot.dazzledUntil = Math.max(bot.dazzledUntil, bot.blindUntil + 2.5);
}
}
} else {
effects.smoke(position.clone().setY(0.35));
if (!shotMode) audio.beep(300);
}
grenades.splice(i, 1);
}
}
function updateObjective(dt) {
const state = match.state;
const bomb = state.bomb;
if (state.phase !== 'live') {
hud.setInteract(false, 0, '');
return;
}
const playerIsAttacker = state.sideOf(player.state.team) === 'attack';
const playerSite = map.siteAt(player.state.position.x, player.state.position.z);
const playerInSite = Boolean(playerSite);
const playerNearBomb = Math.hypot(player.state.position.x - bomb.position.x, player.state.position.z - bomb.position.z) < 2.1;
if (bomb.state === 'carried') {
const carrier = bomb.carrier;
if (!carrier || !carrier.alive) {
if (carrier) match.dropBomb(carrier.position.x, carrier.position.z);
hud.setInteract(false, 0, '');
return;
}
if (bomb.carrier === player.state) {
const inSite = playerInSite;
const holding = input.state.keys.has('KeyE');
if (inSite && holding) {
bomb.plantProgress = Math.min(1, bomb.plantProgress + dt / 3.2);
if (bomb.plantProgress >= 1) {
match.plant(player.state, player.state.position.x, player.state.position.z, playerSite.id);
effects.impact(new THREE.Vector3(player.state.position.x, 0.2, player.state.position.z), new THREE.Vector3(0, 1, 0));
if (!shotMode) audio.plant();
bombBeep = 0;
hud.setBanner(match.state.banner);
}
} else {
bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 1.4);
}
hud.setInteract(inSite, bomb.plantProgress, `HOLD E — PLANT AT ${playerSite?.label ?? ''}`);
} else {
const inSite = map.siteAt(carrier.position.x, carrier.position.z);
if (inSite && carrier.interacting === 'plant') {
bomb.plantProgress = Math.min(1, bomb.plantProgress + dt / 3.2);
if (bomb.plantProgress >= 1) {
match.plant(carrier, carrier.position.x, carrier.position.z, inSite.id);
if (!shotMode) audio.plant();
bombBeep = 0;
}
} else {
bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 1.4);
}
hud.setInteract(false, 0, '');
}
} else if (bomb.state === 'planted') {
let rate = 0;
let defuser = null;
if (!playerIsAttacker && player.state.alive && playerNearBomb && input.state.keys.has('KeyE')) {
rate = 1 / (loadout.kit ? 5 : 10);
defuser = player.state;
}
for (const bot of bots.roster) {
if (!bot.alive || bot.team === state.attackerTeam || bot.interacting !== 'defuse' || Math.hypot(bot.position.x - bomb.position.x, bot.position.z - bomb.position.z) >= 1.7) continue;
const botRate = 1 / (bot.hasKit ? 5 : 10);
if (botRate > rate) {
rate = botRate;
defuser = bot;
}
}
if (rate > 0 && defuser) {
bomb.defuseProgress = Math.min(1, bomb.defuseProgress + dt * rate);
bomb.defuser = defuser;
if (bomb.defuseProgress >= 1) {
match.defused(defuser);
if (!shotMode) audio.defuse();
match.finishRound(otherTeam(state.attackerTeam), 'PULSE CORE DEFUSED', matchCtx);
hud.setInteract(false, 0, '');
return;
}
} else {
bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 0.5);
}
if (!playerIsAttacker && player.state.alive && playerNearBomb) {
hud.setInteract(true, bomb.defuseProgress, 'HOLD E — DEFUSE PULSE CORE');
} else {
hud.setInteract(false, 0, '');
}
bombBeep -= dt;
if (bombBeep <= 0) {
const urgency = Math.max(0.16, Math.min(1, bomb.timer / 40));
bombBeep = 0.22 + urgency * 0.85;
if (!shotMode) audio.beep(bomb.timer < 10 ? 1180 : 860);
}
} else {
hud.setInteract(false, 0, '');
}
}
function pickupBombIfDropped() {
const bomb = match.state.bomb;
const state = match.state;
if (bomb.state !== 'dropped' || state.phase !== 'live') return;
if (player.state.alive && player.state.team === state.attackerTeam &&
Math.hypot(player.state.position.x - bomb.position.x, player.state.position.z - bomb.position.z) < 1.3) {
match.pickup(player.state);
if (!shotMode) audio.buy();
return;
}
const bot = bots.nearestAttacker(state.attackerTeam, bomb.position, 1.3);
if (bot) {
match.pickup(bot);
// A replacement carrier goes straight to the site, not back through its old spawn route.
bot.siteId = state.attackSite ?? bot.siteId;
bot.routeIndex = map.routes[bot.siteId][bot.slot % 3].length;
bot.repathTimer = 0;
return;
}
}
function buyData() {
const state = match.state;
const owned = new Set();
const allowed = new Set();
if (loadout.primaryId) owned.add(loadout.primaryId);
if (player.state.armor >= 100) owned.add('armor');
if (player.state.helmet) owned.add('helmet');
if (loadout.kit) owned.add('kit');
for (const type of Object.keys(GRENADE_DEFS)) if (loadout.grenades[type] > 0) owned.add(type);
for (const item of BUY_LIST) allowed.add(item.id);
if (state.sideOf(player.state.team) !== 'defend') allowed.delete('kit');
return { money: state.playerMoney, owned, allowed };
}
function openBuy() {
cancelGrenade();
hud.setBuyOpen(true, buyData());
input.clearPressed();
input.exitLock();
}
function closeBuy() {
hud.setBuyOpen(false);
input.clearPressed();
if (started) input.requestLock();
}
function buyItem(id) {
const state = match.state;
if (!match.isBuyPhase()) return;
const item = BUY_LIST.find((entry) => entry.id === id);
if (!item) return;
const owned = buyData().owned;
if (owned.has(id)) return;
if (id === 'kit' && state.sideOf(player.state.team) !== 'defend') return;
if (state.playerMoney < item.price) return;
if (id === 'armor') {
player.state.armor = 100;
} else if (id === 'helmet') {
player.state.armor = 100;
player.state.helmet = true;
} else if (id === 'kit') {
loadout.kit = true;
} else if (GRENADE_DEFS[id]) {
loadout.grenades[id] = 1;
hud.setGrenades(loadout.grenades, grenadeSlot);
} else {
loadout.primary = createGun(id);
loadout.primaryId = id;
loadout.slot = 'primary';
equipGun();
}
state.playerMoney = Math.max(0, state.playerMoney - item.price);
if (!shotMode) audio.buy();
hud.setMoney(state.playerMoney);
hud.refreshBuy(buyData());
syncGunHud();
}
function resetCareer() {
player.state.kills = 0;
player.state.deaths = 0;
player.state.armor = 0;
player.state.helmet = false;
loadout.primary = null;
loadout.primaryId = null;
loadout.slot = 'pistol';
loadout.grenades = { frag: 0, flash: 0, smoke: 0 };
loadout.kit = false;
for (const bot of bots.roster) {
bot.money = 800;
bot.kills = 0;
bot.deaths = 0;
bot.armor = 0;
bot.helmet = false;
bot.hasKit = false;
bot.primaryId = null;
}
for (const grenade of grenades) scene.remove(grenade.mesh);
grenades.length = 0;
}
function prepareRound() {
const state = match.state;
const wasDead = !player.state.alive;
if (wasDead) {
loadout.primary = null;
loadout.primaryId = null;
loadout.slot = 'pistol';
loadout.kit = false;
player.state.armor = 0;
player.state.helmet = false;
}
loadout.grenades = { frag: 0, flash: 0, smoke: 0 };
if (grenadeSlot) cancelGrenade();
const side = state.sideOf(player.state.team);
const spawn = (side === 'attack' ? map.spawns.ember : map.spawns.warden)[0];
player.respawn(spawn, player.state.team);
player.state.yaw = side === 'attack' ? 0 : Math.PI;
gunRefill(pistol);
if (loadout.primary) gunRefill(loadout.primary);
equipGun();
view.state.lowered = false;
state.attackSite = rng() < 0.5 ? 'A' : 'B';
state.bomb.siteId = null;
bots.resetRound(state.attackerTeam, player.state.team, state.attackSite);
bots.buy(state.attackerTeam, state.lossStreak);
bots.refreshGuns();
if (side === 'attack') {
match.pickup(player.state);
} else {
const attackers = bots.roster.filter((bot) => bot.alive && bot.team === state.attackerTeam);
if (attackers.length) match.pickup(attackers[Math.floor(rng() * attackers.length)]);
}
effects.clear();
for (const grenade of grenades) scene.remove(grenade.mesh);
grenades.length = 0;
footMoved = 0;
bombBeep = 0;
shake = 0;
hud.setDeath(false);
hud.setBoardOpen(false);
hud.setBuyOpen(false);
openBuy();
hud.setVitals(player.state.health, player.state.armor, true);
hud.setMoney(state.playerMoney);
hud.setFeed(state.feed);
syncGunHud();
}
function rowsForBoard() {
const rows = [{
name: 'YOU', team: player.state.team, kills: player.state.kills, deaths: player.state.deaths,
money: match.state.playerMoney, alive: player.state.alive, me: true,
}];
for (const bot of bots.roster) {
rows.push({ name: bot.name, team: bot.team, kills: bot.kills, deaths: bot.deaths, money: bot.money, alive: bot.alive, me: false });
}
return rows;
}
function objectiveText() {
const state = match.state;
if (state.phase === 'menu') return '';
if (state.phase === 'buy') return 'BUY PHASE — PRESS <b>B</b> FOR THE ARMORY';
if (state.phase === 'roundEnd' || state.phase === 'halftime' || state.phase === 'matchEnd') return '';
if (!player.state.alive) return 'SPECTATING — <b>ROUND IN PROGRESS</b>';
const defending = state.sideOf(player.state.team) === 'defend';
if (hud.els.interact.classList.contains('on')) return '';
if (state.bomb.state === 'planted') return `${defending ? 'RETAKE' : 'HOLD'} <b>SITE ${state.bomb.siteId}</b>`;
if (defending) return 'DEFEND <b>A / B</b>';
if (state.bomb.carrier === player.state) return 'CARRY CORE TO <b>A / B</b>';
return `MOVE ON <b>SITE ${state.attackSite ?? 'A'}</b>`;
}
function tickHud(dt) {
const state = match.state;
syncGunHud();
hud.setStance(player.state.crouching);
hud.setGrenadeHint(grenadeSlot ? `${GRENADE_DEFS[grenadeSlot].name} SELECTED — LMB THROW` : '');
hud.setVitals(player.state.health, player.state.armor, player.state.alive);
hud.setMoney(state.playerMoney);
hud.setTimer(state);
hud.setBanner(state.banner);
hud.setFeed(state.feed);
hud.setCrosshair(shotMode ? 0.0025 : gunSpread(activeGun, Math.hypot(player.state.velocity.x, player.state.velocity.z), player.state.crouching));
hud.setObjective(objectiveText());
const dead = state.phase === 'live' && !player.state.alive;
hud.setDeath(dead);
hud.setHint(!shotMode && started && !input.state.locked && !hud.buyOpen && !hud.boardOpen && (state.phase === 'live' || state.phase === 'buy'));
for (const bot of bots.roster) {
if (bot.team === player.state.team || !bot.alive) {
bot.spotted = false;
continue;
}
const distance = Math.hypot(bot.position.x - player.state.position.x, bot.position.z - player.state.position.z);
bot.spotted = distance < 44 && map.lineOfSight(player.state.position.x, player.state.position.z, bot.position.x, bot.position.z) &&
!effects.smokeBlocks(player.state.position.x, player.state.position.z, bot.position.x, bot.position.z);
}
hud.setRadar(radarData, dt);
if (hud.boardOpen) {
boardTick -= dt;
if (boardTick <= 0) {
boardTick = 0.25;
hud.refreshBoard(rowsForBoard(), state);
}
}
if (hud.buyOpen) {
buyTick -= dt;
if (buyTick <= 0) {
buyTick = 0.3;
hud.refreshBuy(buyData());
}
}
}
const matchCtx = {
bots: bots.roster,
onRoundStart: prepareRound,
onLive() {
hud.setBuyOpen(false);
if (!shotMode) audio.roundStart();
},
onTimeExpired() {
match.finishRound(otherTeam(match.state.attackerTeam), 'TIME EXPIRED', matchCtx);
},
onBombExplode: explodeBomb,
onRoundEnd(winner) {
hud.setBoardOpen(false);
if (!shotMode) {
if (winner === player.state.team) audio.win();
else audio.lose();
}
},
onMatchEnd() {
hud.showMatchEnd();
hud.refreshBoard(rowsForBoard(), match.state);
input.exitLock();
},
onSideSwap() {},
};
const botCtx = {
bots: bots.roster,
player: player.state,
combatants,
bomb: match.state.bomb,
attackerTeam: 'ember',
now: 0,
effects,
audio,
onDamage(entity, amount, part, attacker, def) {
applyDamage(entity, amount, part, attacker, def);
},
noise(x, z, team) {
bots.hear(x, z, team, match.state.now);
},
};
function simulationStep(dt) {
combatants.forEach((entity, i) => previousPositions[i].copy(entity.position));
previousEye = player.state.eye;
const state = match.state;
if (state.phase === 'menu') {
player.step(dt, input.state.keys, false);
view.update(dt, activeGun);
effects.update(dt);
return;
}
if (state.phase === 'live' && player.state.alive && input.state.locked && !hud.buyOpen && !hud.boardOpen) {
if (input.consume('Digit1')) switchSlot('primary');
if (input.consume('Digit2')) switchSlot('pistol');
if (input.consume('Digit4')) selectGrenade('frag');
if (input.consume('Digit5')) selectGrenade('flash');
if (input.consume('Digit6')) selectGrenade('smoke');
if (grenadeSlot) {
if (input.consume('Mouse0')) throwGrenade(grenadeSlot);
} else {
if (input.consume('KeyR') && gunReload(activeGun) && !shotMode) audio.reload(activeGun.def.reload);
const wantFire = activeGun.def.auto ? input.state.firing : input.consume('Mouse0');
if (wantFire) shoot();
if (activeGun.mag === 0) gunReload(activeGun);
}
}
match.step(dt, matchCtx);
const phaseNow = match.state.phase;
const canMove = phaseNow === 'live' && player.state.alive;
const moved = player.step(dt, input.state.keys, canMove);
const speed = Math.hypot(player.state.velocity.x, player.state.velocity.z);
if (canMove) {
footMoved += moved;
if (footMoved > 2.3 && speed > 1.5) {
footMoved = 0;
if (!shotMode) audio.step(0, 0.9);
}
view.setMotion(speed, player.state.onGround, player.state.crouching);
} else {
view.setMotion(0, true, false);
}
stepGun(pistol, dt, speed);
if (loadout.primary) stepGun(loadout.primary, dt, speed);
view.update(dt, activeGun);
if (phaseNow === 'live') {
botCtx.now = match.state.now;
botCtx.attackerTeam = match.state.attackerTeam;
bots.step(dt, botCtx);
pickupBombIfDropped();
updateObjective(dt);
} else {
hud.setInteract(false, 0, '');
}
updateGrenades(dt);
effects.update(dt);
shake = Math.max(0, shake - dt * 0.12);
}
function onLockChange(locked) {
if (!locked && started) hud.setHint(!hud.buyOpen && !hud.boardOpen && match.state.phase === 'live');
}
function restartMatch(side = null) {
if (side) player.state.team = side === 'defend' ? 'warden' : 'ember';
match.state.playerTeam = player.state.team;
resetCareer();
started = true;
hud.setMenu(false);
hud.setBoardOpen(false);
fullResumeAudio();
match.startMatch(matchCtx);
tickHud(0);
}
function fullResumeAudio() {
try { audio.unlock(); } catch { /* audio is optional */ }
}
hud.onPlay((side) => {
fullResumeAudio();
if (match.state.phase === 'matchEnd') restartMatch(side);
else if (!started) restartMatch(side);
});
hud.onCloseBuy(closeBuy);
hud.onBuy(buyItem);
hud.onCloseBoard(() => {
if (match.state.phase === 'matchEnd') restartMatch();
else {
hud.setBoardOpen(false);
input.requestLock();
}
});
renderer.domElement.addEventListener('click', () => {
if (!started || hud.buyOpen || hud.boardOpen) return;
if (match.state.phase === 'live' || match.state.phase === 'buy' || match.state.phase === 'roundEnd') {
input.requestLock();
fullResumeAudio();
}
});
window.addEventListener('keydown', (event) => {
if (!started) return;
if (event.code === 'KeyB') {
if (hud.buyOpen) closeBuy();
else if (match.isBuyPhase()) openBuy();
} else if (hud.buyOpen && /^Digit[1-9]$/.test(event.code)) {
input.consume(event.code);
const item = BUY_LIST[Number(event.code.slice(5)) - 1];
if (item) buyItem(item.id);
} else if (event.code === 'Tab') {
if (hud.boardOpen) {
hud.setBoardOpen(false);
} else {
hud.setBoardOpen(true);
hud.refreshBoard(rowsForBoard(), match.state);
}
} else if (event.code === 'KeyR' && match.state.phase === 'matchEnd') {
restartMatch();
}
});
window.addEventListener('resize', () => {
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
renderer.setSize(window.innerWidth, window.innerHeight);
});
// Adaptive resolution: a weak GPU scales the picture down, never the round clock.
// Screenshots run at full quality and never touch this.
const quality = { scale: 1, cooldown: 0 };
function adaptQuality(dt) {
if (shotMode) return;
quality.cooldown -= dt;
const fps = window.__fps ?? 60;
if (quality.cooldown <= 0 && fps < 24 && quality.scale > 0.5) {
quality.scale = Math.max(0.5, quality.scale - 0.125);
quality.cooldown = 2;
} else if (quality.cooldown <= 0 && fps > 55 && quality.scale < 1) {
quality.scale = Math.min(1, quality.scale + 0.125);
quality.cooldown = 4;
}
const ratio = Math.min(window.devicePixelRatio, 2) * quality.scale;
if (Math.abs(renderer.getPixelRatio() - ratio) > 1e-3) renderer.setPixelRatio(ratio);
}
window.__quality = quality;
function bootMenuScene() {
match.state.phase = 'menu';
match.state.scores.ember = 0;
match.state.scores.warden = 0;
match.state.round = 1;
match.state.playerMoney = 800;
player.state.position.set(0, 0, 13.5);
player.state.yaw = 0;
player.state.pitch = -0.02;
player.state.health = 100;
player.state.armor = 0;
player.state.alive = true;
bots.resetRound('ember', 'ember');
const tableau = [
[0, 8.5], [-3.5, 9.5], [4, 10.5], [-5, 12],
];
for (let i = 0; i < tableau.length; i += 1) {
const bot = bots.roster[i];
bot.position.set(tableau[i][0], 0, tableau[i][1]);
bot.yaw = Math.PI;
}
const enemies = [[0, -4], [-4.5, -6], [4.5, -6], [-6, -2], [6, -2]];
for (let i = 0; i < enemies.length; i += 1) {
const bot = bots.roster[4 + i];
bot.position.set(enemies[i][0], 0, enemies[i][1]);
bot.yaw = 0;
}
bots.syncModels(botCtx);
hud.setMenu(true);
hud.setBuyOpen(false);
hud.setBoardOpen(false);
hud.setTimer(match.state);
hud.setMoney(800);
hud.setVitals(100, 0, true);
hud.setFeed(match.state.feed);
hud.setBanner({ text: '', sub: '', time: 0 });
hud.setDeath(false);
equipGun();
view.update(0.016, activeGun);
}
function setupShotStart() {
const state = match.state;
state.phase = 'buy';
state.round = 1;
state.buyTimer = 13;
state.roundTimer = 100;
state.scores.ember = 0;
state.scores.warden = 0;
state.attackerTeam = 'ember';
state.playerTeam = 'ember';
state.playerMoney = 4300;
state.now = 12;
state.bomb.state = 'carried';
state.bomb.carrier = player.state;
state.bomb.timer = 40;
state.banner = { text: 'ROUND 1', sub: 'BUY PHASE // FOUNDRY', time: 2.4 };
player.state.position.set(0, 0, 13.5);
player.state.yaw = 0.02;
player.state.pitch = -0.015;
player.state.health = 100;
player.state.armor = 100;
player.state.helmet = true;
player.state.alive = true;
player.state.crouching = false;
player.state.height = 1.76;
loadout.primary = null;
loadout.primaryId = null;
loadout.slot = 'pistol';
loadout.grenades = { frag: 0, flash: 0, smoke: 0 };
loadout.kit = false;
gunRefill(pistol);
equipGun();
view.state.lowered = false;
bots.resetRound('ember', 'ember');
const allies = [[-7.4, 6.6], [7.2, 6.2], [-8.8, 10.2], [8.6, 10.8]];
for (let i = 0; i < allies.length; i += 1) {
const bot = bots.roster[i];
bot.position.set(allies[i][0], 0, allies[i][1]);
bot.yaw = -0.2;
}
bots.buy('ember');
bots.refreshGuns();
bots.syncModels(botCtx);
effects.clear();
hud.setMenu(false);
hud.setBoardOpen(false);
hud.setDeath(false);
hud.setBuyOpen(true, buyData());
hud.setVitals(100, 100, true);
hud.setMoney(4300);
hud.setFeed([]);
syncGunHud();
tickHud(0.016);
hud.setBuyOpen(true, buyData());
}
function setupShotPlay() {
if (seed === 7) {
setupShotPlant();
return;
}
const state = match.state;
state.phase = 'live';
state.round = 5;
state.roundTimer = 67;
state.scores.ember = 2;
state.scores.warden = 2;
state.attackerTeam = 'ember';
state.playerTeam = 'ember';
state.playerMoney = 2450;
state.now = 220;
state.bomb.state = 'carried';
state.bomb.carrier = player.state;
state.bomb.timer = 40;
state.bomb.plantProgress = 0;
state.banner = { text: '', sub: '', time: 0 };
state.feed = [
{ killer: 'PYRE', victim: 'VALE', weapon: 'RATTLER', headshot: false, killerTeam: 'ember', self: false },
{ killer: 'SABLE', victim: 'COVE', weapon: 'LONGBOW', headshot: true, killerTeam: 'warden', self: false },
{ killer: 'YOU', victim: 'HARROW', weapon: 'LONGBOW', headshot: true, killerTeam: 'ember', self: true },
];
player.state.position.set(-12, 0, 3);
player.state.yaw = 0.03;
player.state.pitch = -0.02;
player.state.health = 74;
player.state.armor = 54;
player.state.helmet = false;
player.state.alive = true;
player.state.kills = 11;
player.state.deaths = 4;
player.state.crouching = true;
player.state.height = 1.14;
player.state.eye = 1.0;
loadout.primary = createGun('longbow');
loadout.primaryId = 'longbow';
loadout.slot = 'primary';
loadout.grenades = { frag: 1, flash: 1, smoke: 1 };
loadout.kit = false;
equipGun();
loadout.primary.mag = 22;
loadout.primary.reserve = 90;
view.state.lowered = false;
playersShotBots();
syncGunHud();
hud.setMenu(false);
hud.setBoardOpen(false);
hud.setDeath(false);
hud.setBuyOpen(false);
hud.setVitals(74, 54, true);
hud.setMoney(2450);
hud.setFeed(state.feed);
hud.setBanner(state.banner);
hud.setObjective(objectiveText());
hud.setCrosshair(0.012);
hud.setInteract(false, 0, '');
const target = bots.roster[4];
target.position.set(-12.8, 0, -6.4);
bots.syncModels(botCtx);
aimAngles(-12.8, 1.1, -6.4);
shoot();
effects.freeze();
view.update(0.016, activeGun);
hud.setAmmo(activeGun.mag, activeGun.reserve, activeGun.def.name, false);
hud.forceHit(false);
tickHud(0.016);
hud.setCrosshair(0.014);
hud.setFeed(state.feed);
}
function setupShotPlant() {
const state = match.state;
state.phase = 'live';
state.round = 8;
state.roundTimer = 54;
state.scores.ember = 3;
state.scores.warden = 4;
state.attackerTeam = 'ember';
state.playerTeam = 'ember';
state.playerMoney = 3150;
state.now = 331;
state.bomb.state = 'carried';
state.bomb.carrier = player.state;
state.bomb.timer = 40;
state.bomb.plantProgress = 0.52;
state.banner = { text: '', sub: '', time: 0 };
state.feed = [];
player.state.position.set(12, 0, -3);
player.state.yaw = 0.02;
player.state.pitch = -0.36;
player.state.health = 88;
player.state.armor = 100;
player.state.helmet = true;
player.state.alive = true;
player.state.kills = 13;
player.state.deaths = 5;
player.state.crouching = false;
player.state.height = 1.76;
player.state.eye = 1.6;
loadout.primary = createGun('longbow');
loadout.primaryId = 'longbow';
loadout.slot = 'primary';
loadout.grenades = { frag: 1, flash: 1, smoke: 0 };
loadout.kit = false;
equipGun();
loadout.primary.mag = 19;
loadout.primary.reserve = 90;
view.state.lowered = false;
playersShotBots();
effects.smoke(new THREE.Vector3(4.6, 0.35, -5.8));
effects.setCameraQuaternion(camera.quaternion);
effects.update(0.24);
syncGunHud();
hud.setMenu(false);
hud.setBoardOpen(false);
hud.setDeath(false);
hud.setBuyOpen(false);
hud.setVitals(88, 100, true);
hud.setMoney(3150);
hud.setFeed(state.feed);
hud.setBanner(state.banner);
hud.setObjective(objectiveText());
hud.setCrosshair(0.006);
hud.setInteract(true, 0.52, 'HOLD E — PLANT AT COOLANT LOOP');
view.update(0.016, activeGun);
tickHud(0.016);
hud.setInteract(true, 0.52, 'HOLD E — PLANT AT COOLANT LOOP');
}
function playersShotBots() {
bots.resetRound('ember', 'ember');
const allies = [[5.6, 4.2, -0.6], [-6.4, 2.2, 0.5], [2.8, 10.5, 0.0], [-4.2, 12.0, 0.1]];
for (let i = 0; i < 4; i += 1) {
const bot = bots.roster[i];
bot.position.set(allies[i][0], 0, allies[i][1]);
bot.yaw = allies[i][2];
bot.health = 100;
bot.alive = true;
bot.primaryId = i === 0 ? 'rattler' : 'longbow';
bot.gun = createGun(bot.primaryId);
bot.gun.mag = bot.gun.def.mag - 3;
bot.kills = 3 + i;
bot.deaths = i === 2 ? 2 : 1;
bot.money = 2400 + i * 350;
}
const enemies = [[-3.2, -3.2, Math.PI], [3.6, -5.0, Math.PI - 0.18], [-5.8, -7.4, Math.PI + 0.2], [7.0, -8.0, Math.PI - 0.3], [0.0, -9.6, Math.PI]];
for (let i = 0; i < 5; i += 1) {
const bot = bots.roster[4 + i];
bot.position.set(enemies[i][0], 0, enemies[i][1]);
bot.yaw = enemies[i][2];
bot.health = i === 0 ? 66 : 100;
bot.alive = true;
bot.primaryId = i === 4 ? 'talon' : 'longbow';
bot.gun = createGun(bot.primaryId);
bot.kills = 2 + (i % 3);
bot.deaths = 1 + (i % 2);
bot.money = 1800 + i * 420;
}
bots.syncModels(botCtx);
}
function setupShotEnd() {
setupShotPlay();
const state = match.state;
state.phase = 'matchEnd';
state.round = 13;
state.scores.ember = 7;
state.scores.warden = 6;
state.matchWinner = 'ember';
state.banner = { text: 'EMBER WINS THE MATCH', sub: '7 : 6 // FOUNDRY', time: 999 };
tickHud(0.016);
hud.setBoardOpen(true);
hud.refreshBoard(rowsForBoard(), state);
}
function paintShot(times = 3) {
let painted = 0;
function paint() {
requestAnimationFrame(paint);
syncCamera();
camera.updateMatrixWorld(true);
renderer.render(scene, camera);
painted += 1;
if (painted === times) window.__shotReady = true;
}
requestAnimationFrame(paint);
}
function runShot(name) {
started = true;
bootMenuScene();
hud.setMenu(name === 'menu');
if (name === 'start') setupShotStart();
else if (name === 'play') setupShotPlay();
else if (name === 'plant') setupShotPlant();
else if (name === 'menu') hud.setMenu(true);
else setupShotEnd();
hud.setRadar(radarData, 0.2);
syncCamera();
effects.setCameraQuaternion(camera.quaternion);
camera.updateMatrixWorld(true);
renderer.render(scene, camera);
requestAnimationFrame(() => {
syncCamera();
effects.setCameraQuaternion(camera.quaternion);
renderer.render(scene, camera);
paintShot(2);
});
}
function frame(now) {
requestAnimationFrame(frame);
const dt = Math.min((now - lastTime) / 1000, 0.1);
lastTime = now;
if (!started) {
syncCamera();
renderer.render(scene, camera);
return;
}
const look = input.takeLook();
if (input.state.locked) player.look(look.x, look.y);
accumulator += dt;
// Catch up to the clamped frame time: a slow renderer slows the picture, not the clock.
const maxSteps = Math.ceil(0.1 / FIXED_STEP);
let steps = 0;
while (accumulator >= FIXED_STEP && steps < maxSteps) {
simulationStep(FIXED_STEP);
accumulator -= FIXED_STEP;
steps += 1;
}
if (accumulator > FIXED_STEP * maxSteps) accumulator = 0;
stats.frames += 1;
if (now - stats.since >= 1000) {
window.__fps = stats.frames * 1000 / (now - stats.since);
stats.frames = 0;
stats.since = now;
}
window.__clock = { accumulator, steps };
adaptQuality(dt);
tickHud(dt);
syncCamera();
const alpha = Math.min(1, accumulator / FIXED_STEP);
camera.position.lerpVectors(previousPositions[0], player.state.position, alpha);
camera.position.y += THREE.MathUtils.lerp(previousEye, player.state.eye, alpha);
bots.roster.forEach((bot, i) => {
if (bot.alive) bot.model.group.position.lerpVectors(previousPositions[i + 1], bot.position, alpha);
});
effects.setCameraQuaternion(camera.quaternion);
renderer.render(scene, camera);
}
bootMenuScene();
tickHud(0.016);
if (shotMode) runShot(shotMode);
else requestAnimationFrame(frame);
