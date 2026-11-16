import * as THREE from 'three';
import { createMover } from './physics.js';
import { createGun, stepGun, gunReady, gunFire, gunReload, WEAPONS } from './weapon.js';
import { castShot, damageFor, spreadDirection } from './combat.js';
import { PALETTE, teamColor } from './palette.js';
const ALLY_NAMES = ['PYRE', 'BRAND', 'COVE', 'ASH'];
const ENEMY_NAMES = ['SLATE', 'MORROW', 'VALE', 'HARROW', 'SABLE'];
const tempDir = new THREE.Vector3();
const tempAim = new THREE.Vector3();
const eyePoint = new THREE.Vector3();
function shortestAngle(from, to) {
let delta = (to - from) % (Math.PI * 2);
if (delta > Math.PI) delta -= Math.PI * 2;
if (delta < -Math.PI) delta += Math.PI * 2;
return delta;
}
function forwardOf(yaw, pitch, out) {
const cp = Math.cos(pitch);
out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
return out;
}
function makeModel() {
const group = new THREE.Group();
const parts = { materials: [] };
const mat = (color, metalness = 0.25, roughness = 0.7, emissive = 0) => {
const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness, roughness });
if (emissive) {
material.emissive = new THREE.Color(color);
material.emissiveIntensity = emissive;
}
parts.materials.push({ material, role: 'team' });
return material;
};
const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#283238'), roughness: 0.8, metalness: 0.15 });
const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3b4850'), roughness: 0.75, metalness: 0.2 });
const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#a37f61'), roughness: 0.9 });
const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), vest);
torso.position.y = 1.22;
torso.castShadow = true;
group.add(torso);
const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.05), mat(PALETTE.ember, 0.35, 0.55, 0.4));
chest.position.set(0, 1.3, -0.155);
group.add(chest);
const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.26), dark);
belt.position.y = 0.92;
group.add(belt);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skin);
head.position.y = 1.69;
head.castShadow = true;
group.add(head);
const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.205, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), dark);
helmet.position.y = 1.71;
group.add(helmet);
const visor = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.07, 0.05), mat(PALETTE.warden, 0.4, 0.4, 1.0));
visor.position.set(0, 1.7, -0.165);
group.add(visor);
const legGeo = new THREE.BoxGeometry(0.16, 0.62, 0.18);
const legL = new THREE.Mesh(legGeo, dark);
const legR = new THREE.Mesh(legGeo, dark);
legL.geometry.translate(0, -0.31, 0);
legR.geometry = legL.geometry;
legL.position.set(-0.13, 0.9, 0);
legR.position.set(0.13, 0.9, 0);
legL.castShadow = legR.castShadow = true;
group.add(legL, legR);
const armGeo = new THREE.BoxGeometry(0.13, 0.5, 0.14);
armGeo.translate(0, -0.25, 0);
const armL = new THREE.Mesh(armGeo, vest);
const armR = new THREE.Mesh(armGeo, vest);
armL.position.set(-0.3, 1.48, 0);
armR.position.set(0.3, 1.48, 0);
const padL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.16), mat(PALETTE.ember, 0.3, 0.55, 0.45));
padL.position.set(-0.3, 1.46, 0);
const padR = padL.clone();
padR.position.x = 0.3;
group.add(armL, armR, padL, padR);
const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.52), dark);
gun.position.set(0.16, 1.28, -0.32);
group.add(gun);
const gunAccent = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), mat(PALETTE.hazard, 0.6, 0.3, 0.8));
gunAccent.position.set(0.16, 1.34, -0.36);
group.add(gunAccent);
const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.14), mat(PALETTE.ember, 0.2, 0.6, 0.8));
pack.position.set(0, 1.2, 0.2);
pack.visible = false;
group.add(pack);
parts.torso = torso;
parts.head = head;
parts.legL = legL;
parts.legR = legR;
parts.armL = armL;
parts.armR = armR;
parts.gun = gun;
parts.pack = pack;
return { group, parts };
}
function styleModel(bot) {
const color = teamColor(bot.team);
for (const entry of bot.model.parts.materials) {
entry.material.color.set(color);
if (entry.material.emissive) entry.material.emissive.set(color);
}
}
export function createBotSystem(scene, map, rng) {
const mover = createMover(map.colliders);
const roster = [];
function makeBot(name, ally, slot) {
const model = makeModel();
scene.add(model.group);
const bot = {
id: roster.length,
name,
ally,
slot,
team: ally ? 'ember' : 'warden',
position: new THREE.Vector3(0, 0, 0),
height: 1.76,
radius: 0.34,
alive: true,
health: 100,
armor: 0,
helmet: false,
hasKit: false,
money: 800,
kills: 0,
deaths: 0,
primaryId: null,
gun: createGun('kestrel'),
yaw: 0,
pitch: 0,
target: null,
lastSeen: new THREE.Vector3(),
lastSeenAt: -10,
alertUntil: -10,
blindUntil: -10,
reactionLeft: 0,
thinkTimer: 0,
aimError: 0.013 + (1 - (0.5 + rng() * 0.3)) * 0.045,
reaction: 0.26 + rng() * 0.2,
burstLeft: 0,
burstPause: 0,
strafeDir: 1,
strafeTimer: 0,
path: [],
pathIndex: 0,
repathTimer: 0,
walkPhase: rng() * 6,
stuck: 0,
interacting: null,
deathTimer: 0,
stepTimer: 0,
model,
};
roster.push(bot);
return bot;
}
ALLY_NAMES.forEach((name, index) => makeBot(name, true, index + 1));
ENEMY_NAMES.forEach((name, index) => makeBot(name, false, index));
function spawnFor(bot, attackerTeam) {
const attacking = bot.team === attackerTeam;
const spawns = attacking ? map.spawns.ember : map.spawns.warden;
return spawns[Math.min(bot.slot, spawns.length - 1)];
}
function resetRound(attackerTeam, playerTeam, attackSite = 'A') {
for (const bot of roster) {
bot.team = bot.ally ? playerTeam : playerTeam === 'ember' ? 'warden' : 'ember';
styleModel(bot);
const spawn = spawnFor(bot, attackerTeam);
bot.position.set(spawn.x, 0, spawn.z);
bot.yaw = bot.team === attackerTeam ? 0 : Math.PI;
bot.pitch = 0;
bot.health = 100;
bot.alive = true;
bot.target = null;
bot.lastSeenAt = -10;
bot.alertUntil = -10;
bot.blindUntil = -10;
bot.reactionLeft = 0;
bot.path = [];
bot.pathIndex = 0;
bot.repathTimer = 0;
bot.interacting = null;
bot.deathTimer = 0;
bot.stuck = 0;
bot.siteId = bot.team === attackerTeam ? attackSite : bot.slot % 2 ? 'B' : 'A';
bot.routeIndex = 0;
bot.burstLeft = 0;
bot.burstPause = 0;
bot.gun = createGun(bot.primaryId ?? 'kestrel');
bot.model.group.visible = true;
bot.model.group.rotation.set(0, bot.yaw, 0);
bot.model.group.position.set(bot.position.x, 0, bot.position.z);
bot.model.parts.pack.visible = false;
bot.model.parts.torso.rotation.set(0, 0, 0);
bot.model.parts.head.rotation.set(0, 0, 0);
bot.model.parts.legL.rotation.set(0, 0, 0);
bot.model.parts.legR.rotation.set(0, 0, 0);
}
}
function sideOf(bot, attackerTeam) {
return bot.team === attackerTeam ? 'attack' : 'defend';
}
// Loss-streak eco: save for a rifle and armor rather than force-buying every round.
function buy(attackerTeam, lossStreak = {}) {
for (const bot of roster) {
bot.eco = (lossStreak[bot.team] ?? 0) >= 2 && bot.money < WEAPONS.longbow.price + 650;
if (bot.eco) continue;
const defender = sideOf(bot, attackerTeam) === 'defend';
if (!bot.primaryId) {
if (bot.money >= WEAPONS.talon.price && rng() < 0.16) {
bot.primaryId = 'talon'; bot.money -= WEAPONS.talon.price;
} else if (bot.money >= WEAPONS.longbow.price) {
bot.primaryId = 'longbow'; bot.money -= WEAPONS.longbow.price;
} else if (bot.money >= WEAPONS.rattler.price) {
bot.primaryId = 'rattler'; bot.money -= WEAPONS.rattler.price;
}
}
if (bot.armor <= 0 && bot.money >= 650) {
bot.armor = 100; bot.money -= 650;
}
if (bot.armor > 0 && !bot.helmet && bot.money >= 1000) {
bot.helmet = true; bot.money -= 1000;
}
if (defender && !bot.hasKit && bot.money >= 400) {
bot.hasKit = true; bot.money -= 400;
}
}
}
function refreshGuns() {
for (const bot of roster) bot.gun = createGun(bot.primaryId ?? 'kestrel');
}
function aliveCount(team) {
let count = 0;
for (const bot of roster) if (bot.alive && bot.team === team) count += 1;
return count;
}
function damage(bot, amount, part) {
if (!bot.alive) return false;
let damage = amount;
if (part === 'head' && bot.helmet) damage *= 0.72;
if (bot.armor > 0) {
const absorbed = damage * 0.5;
bot.armor = Math.max(0, bot.armor - absorbed * 0.9);
damage -= absorbed;
}
bot.health = Math.max(0, bot.health - damage);
if (bot.health === 0) {
bot.alive = false;
bot.deathTimer = 0;
bot.armor = 0;
bot.helmet = false;
bot.primaryId = null;
bot.model.parts.pack.visible = false;
return true;
}
return false;
}
function hear(x, z, sourceTeam, now) {
for (const bot of roster) {
if (!bot.alive || bot.team === sourceTeam) continue;
const distance = Math.hypot(bot.position.x - x, bot.position.z - z);
if (distance > 26) continue;
bot.lastSeen.set(x, 0, z);
bot.lastSeenAt = now;
bot.alertUntil = now + 3.2;
}
}
function sightClear(ctx, ax, az, bx, bz) {
return map.lineOfSight(ax, az, bx, bz) && !ctx.effects.smokeBlocks(ax, az, bx, bz);
}
function acquire(bot, ctx) {
if (bot.blindUntil > ctx.now) {
bot.target = null;
return null;
}
let best = null;
let bestDistance = Infinity;
const fx = -Math.sin(bot.yaw);
const fz = -Math.cos(bot.yaw);
for (const entity of ctx.combatants) {
if (!entity || entity === bot || !entity.alive || entity.team === bot.team) continue;
const dx = entity.position.x - bot.position.x;
const dz = entity.position.z - bot.position.z;
const distance = Math.hypot(dx, dz);
if (distance > 68) continue;
if (distance > 6.5) {
const dot = (dx * fx + dz * fz) / (distance || 1);
if (dot < 0.28) continue;
}
if (!sightClear(ctx, bot.position.x, bot.position.z, entity.position.x, entity.position.z)) continue;
if (distance < bestDistance) {
bestDistance = distance;
best = entity;
}
}
if (best) {
if (bot.target !== best) bot.reactionLeft = bot.reaction * (0.7 + rng() * 0.6);
bot.target = best;
bot.lastSeen.copy(best.position);
bot.lastSeenAt = ctx.now;
bot.alertUntil = ctx.now + 1;
} else if (bot.target && (!bot.target.alive || ctx.now - bot.lastSeenAt > 2.4)) {
bot.target = null;
}
return best;
}
function navigate(bot, dt, dest, speed) {
bot.repathTimer -= dt;
if (bot.repathTimer <= 0) {
bot.path = map.findPath(bot.position.x, bot.position.z, dest.x, dest.z);
bot.pathIndex = 0;
bot.repathTimer = 1.1 + rng() * 0.9;
}
let waypoint = bot.path[bot.pathIndex];
while (waypoint && Math.hypot(waypoint.x - bot.position.x, waypoint.z - bot.position.z) < 0.55) {
bot.pathIndex += 1;
waypoint = bot.path[bot.pathIndex];
}
if (!waypoint) {
const distance = Math.hypot(dest.x - bot.position.x, dest.z - bot.position.z);
if (distance < 1.2) return 0;
waypoint = dest;
}
const dx = waypoint.x - bot.position.x;
const dz = waypoint.z - bot.position.z;
const length = Math.hypot(dx, dz) || 1;
const step = Math.min(length, speed * dt);
const moved = mover.moveXZ(bot.position.x, bot.position.z, (dx / length) * step, (dz / length) * step, bot.radius, bot.height);
const actual = Math.hypot(moved.x - bot.position.x, moved.z - bot.position.z);
bot.position.x = moved.x;
bot.position.z = moved.z;
const desiredYaw = Math.atan2(-dx, -dz);
bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, shortestAngle(bot.yaw, desiredYaw)));
bot.walkPhase += actual * 9.5;
if (actual < speed * dt * 0.25) bot.stuck += dt;
else bot.stuck = 0;
if (bot.stuck > 1.4) {
bot.path = [];
bot.repathTimer = 0;
bot.stuck = 0;
bot.yaw += (rng() - 0.5) * 1.4;
}
return actual;
}
function objectiveFor(bot, ctx) {
const bomb = ctx.bomb;
const attacking = bot.team === ctx.attackerTeam;
if (bomb.state === 'planted') {
if (!attacking) return bomb.position;
return map.sites[bomb.siteId];
}
if (bomb.state === 'dropped' && attacking) return bomb.position;
if (ctx.now < bot.alertUntil) return bot.lastSeen;
if (bot.target && ctx.now - bot.lastSeenAt < 2.4) return bot.lastSeen;
if (attacking) {
const route = map.routes[bot.siteId][bot.slot % 3];
let point = route[bot.routeIndex];
if (point && Math.hypot(point.x - bot.position.x, point.z - bot.position.z) < 1.5) point = route[++bot.routeIndex];
if (point) return point;
}
return map.sites[bot.siteId];
}
function engage(bot, dt, ctx) {
const target = bot.target;
if (bot.blindUntil > ctx.now || !target || !target.alive) return false;
const dx = target.position.x - bot.position.x;
const dz = target.position.z - bot.position.z;
const distance = Math.hypot(dx, dz);
const eyeY = bot.position.y + 1.5;
const aimY = target.position.y + Math.min(target.height ?? 1.76, 1.76) * 0.62;
const desiredYaw = Math.atan2(-dx, -dz);
const desiredPitch = Math.atan2(aimY - eyeY, distance || 1);
const turn = (bot.reactionLeft > 0 ? 4 : 9) * dt;
bot.yaw += Math.max(-turn, Math.min(turn, shortestAngle(bot.yaw, desiredYaw)));
bot.pitch += Math.max(-turn, Math.min(turn, desiredPitch - bot.pitch));
bot.strafeTimer -= dt;
if (bot.strafeTimer <= 0) {
bot.strafeDir *= rng() < 0.55 ? -1 : 1;
bot.strafeTimer = 0.5 + rng() * 0.9;
}
const reloading = bot.gun.reloadLeft > 0 || bot.gun.mag === 0;
let moveX = -dz / (distance || 1) * bot.strafeDir;
let moveZ = dx / (distance || 1) * bot.strafeDir;
if (reloading) {
moveX = -dx / (distance || 1);
moveZ = -dz / (distance || 1);
} else if (distance < 7) {
moveX -= dx / (distance || 1) * 0.6;
moveZ -= dz / (distance || 1) * 0.6;
}
const speed = reloading ? 3.4 : distance < 12 ? 2.0 : 2.6;
const len = Math.hypot(moveX, moveZ) || 1;
const moved = mover.moveXZ(bot.position.x, bot.position.z, (moveX / len) * speed * dt, (moveZ / len) * speed * dt, bot.radius, bot.height);
const actual = Math.hypot(moved.x - bot.position.x, moved.z - bot.position.z);
bot.position.x = moved.x;
bot.position.z = moved.z;
bot.walkPhase += actual * 9.5;
if (bot.reactionLeft > 0) {
bot.reactionLeft = Math.max(0, bot.reactionLeft - dt);
return true;
}
if (!sightClear(ctx, bot.position.x, bot.position.z, target.position.x, target.position.z)) return false;
if (bot.burstPause > 0) {
bot.burstPause -= dt;
return true;
}
if (bot.gun.mag === 0 || (bot.gun.mag <= bot.gun.def.mag * 0.2 && distance > 16)) {
gunReload(bot.gun);
return true;
}
if (!gunReady(bot.gun)) return true;
eyePoint.set(bot.position.x, eyeY, bot.position.z);
forwardOf(bot.yaw, bot.pitch, tempDir);
const moving = target.velocity ? Math.hypot(target.velocity.x, target.velocity.z) : 0;
const error = bot.aimError * (0.7 + distance / 55) * (moving > 2 ? 1.5 : 1) * (bot.gun.def.id === 'talon' ? 1.3 : 1);
spreadDirection(tempDir, error, rng, tempAim);
const hit = castShot(eyePoint, tempAim, 90, bot.team, ctx.combatants, map);
gunFire(bot.gun);
if (hit.kind === 'entity') {
const amount = damageFor(bot.gun.def, hit.distance, hit.part);
ctx.onDamage(hit.entity, amount, hit.part, bot, bot.gun.def);
ctx.effects.blood(hit.point, tempDir);
} else if (hit.kind === 'wall') {
ctx.effects.impact(hit.point, hit.normal);
}
const muzzle = tempDir.set(bot.position.x - Math.sin(bot.yaw) * 0.5, eyeY - 0.18, bot.position.z - Math.cos(bot.yaw) * 0.5);
if (hit.distance > 0) ctx.effects.spawnTracer(muzzle, hit.point, teamColor(bot.team));
const pan = Math.max(-0.8, Math.min(0.8, (bot.position.x - ctx.player.position.x) / 24));
ctx.audio.shot(bot.gun.id, pan);
ctx.noise(bot.position.x, bot.position.z, bot.team);
if (bot.gun.def.auto) {
if (bot.burstLeft <= 0) bot.burstLeft = 2 + Math.floor(rng() * 4);
bot.burstLeft -= 1;
if (bot.burstLeft <= 0) bot.burstPause = 0.18 + rng() * 0.3;
} else {
bot.burstPause = 0.22 + rng() * 0.4;
}
return true;
}
function animate(bot, dt, ctx) {
const group = bot.model.group;
group.position.set(bot.position.x, bot.position.y, bot.position.z);
if (!bot.alive) {
bot.deathTimer += dt;
group.rotation.z = Math.min(Math.PI / 2, bot.deathTimer * 5);
group.position.y = Math.min(0.12, bot.deathTimer * 0.6);
if (bot.deathTimer > 9) group.visible = false;
return;
}
group.rotation.z = 0;
group.rotation.y = bot.yaw;
bot.model.parts.head.rotation.x = bot.pitch * 0.7;
bot.model.parts.torso.rotation.x = -bot.pitch * 0.15;
const speed = Math.hypot(bot.position.x - (bot.lastX ?? bot.position.x), bot.position.z - (bot.lastZ ?? bot.position.z)) / Math.max(dt, 0.0001);
bot.lastX = bot.position.x;
bot.lastZ = bot.position.z;
const swing = Math.min(1, speed / 4.5) * 0.65;
bot.model.parts.legL.rotation.x = Math.sin(bot.walkPhase) * swing;
bot.model.parts.legR.rotation.x = -Math.sin(bot.walkPhase) * swing;
bot.model.parts.armL.rotation.x = -Math.sin(bot.walkPhase) * swing * 0.6;
bot.model.parts.armR.rotation.x = Math.sin(bot.walkPhase) * swing * 0.3 - 0.5;
bot.model.parts.pack.visible = ctx.bomb.carrier === bot && ctx.bomb.state !== 'planted';
bot.stepTimer -= dt;
if (speed > 1.4 && bot.stepTimer <= 0) {
bot.stepTimer = 0.34;
const distance = Math.hypot(bot.position.x - ctx.player.position.x, bot.position.z - ctx.player.position.z);
if (distance < 14) ctx.audio.step((bot.position.x - ctx.player.position.x) / 22, Math.max(0.15, 1 - distance / 18));
}
}
function syncModels(ctx) {
for (const bot of roster) {
const group = bot.model.group;
group.visible = bot.alive || bot.deathTimer < 9;
group.position.set(bot.position.x, bot.alive ? bot.position.y : 0.1, bot.position.z);
group.rotation.set(0, bot.yaw, bot.alive ? 0 : Math.PI / 2);
bot.model.parts.head.rotation.x = bot.alive ? bot.pitch * 0.7 : 0;
bot.model.parts.legL.rotation.x = 0;
bot.model.parts.legR.rotation.x = 0;
bot.model.parts.pack.visible = Boolean(ctx?.bomb && ctx.bomb.carrier === bot && ctx.bomb.state !== 'planted');
}
}
function step(dt, ctx) {
const planted = ctx.bomb.state === 'planted';
for (const bot of roster) {
if (!bot.alive) {
animate(bot, dt, ctx);
continue;
}
stepGun(bot.gun, dt);
bot.thinkTimer -= dt;
if (bot.thinkTimer <= 0) {
bot.thinkTimer = 0.11 + rng() * 0.07;
acquire(bot, ctx);
}
const attacking = bot.team === ctx.attackerTeam;
const carrier = ctx.bomb.carrier === bot && ctx.bomb.state === 'carried';
const site = map.sites[bot.siteId];
const siteDistance = Math.hypot(bot.position.x - site.x, bot.position.z - site.z);
let objectivePause = false;
if (carrier && siteDistance < site.radius - 0.6) {
objectivePause = true;
const face = Math.atan2(-(site.x - bot.position.x), -(site.z - bot.position.z));
bot.yaw += Math.max(-5 * dt, Math.min(5 * dt, shortestAngle(bot.yaw, face)));
bot.interacting = 'plant';
} else if (planted && !attacking) {
const distance = Math.hypot(bot.position.x - ctx.bomb.position.x, bot.position.z - ctx.bomb.position.z);
if (distance < 1.7) {
objectivePause = true;
const face = Math.atan2(-(ctx.bomb.position.x - bot.position.x), -(ctx.bomb.position.z - bot.position.z));
bot.yaw += Math.max(-5 * dt, Math.min(5 * dt, shortestAngle(bot.yaw, face)));
bot.pitch += Math.max(-5 * dt, Math.min(5 * dt, -0.5 - bot.pitch));
bot.interacting = 'defuse';
} else {
bot.interacting = null;
}
} else {
bot.interacting = null;
}
const engaged = !objectivePause && bot.target && bot.target.alive ? engage(bot, dt, ctx) : false;
if (!objectivePause && !engaged) {
const dest = objectiveFor(bot, ctx);
const speed = ctx.now < bot.alertUntil ? 4.8 : 4.35;
navigate(bot, dt, dest, speed);
}
animate(bot, dt, ctx);
}
}
return { roster, resetRound, buy, refreshGuns, aliveCount, damage, hear, step, styleModel, syncModels };
}
