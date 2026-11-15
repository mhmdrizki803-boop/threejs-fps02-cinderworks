import * as THREE from 'three';
import { PALETTE } from './palette.js';
export const WEAPONS = {
kestrel: {
id: 'kestrel', name: 'KESTREL-9', slot: 'pistol', price: 0, damage: 27, head: 3.4,
mag: 15, reserve: 60, fireGap: 0.15, auto: false, reload: 1.55, falloff: 0.72,
spreadStill: 0.0032, spreadMove: 0.034, bloom: 0.0035, bloomMax: 0.02, recoil: 0.7,
pattern: [[-0.005, 0.001], [-0.007, -0.002], [-0.009, 0.003], [-0.011, -0.004], [-0.009, 0.002], [-0.013, 0.005]],
},
rattler: {
id: 'rattler', name: 'RATTLER', slot: 'primary', price: 1250, damage: 22, head: 3.1,
mag: 30, reserve: 90, fireGap: 0.078, auto: true, reload: 2.05, falloff: 0.62,
spreadStill: 0.0045, spreadMove: 0.062, bloom: 0.0024, bloomMax: 0.032, recoil: 0.9,
pattern: [[-0.006, 0.002], [-0.008, -0.003], [-0.011, 0.004], [-0.013, -0.005], [-0.014, 0.003], [-0.012, -0.002], [-0.015, 0.005], [-0.017, -0.004]],
},
longbow: {
id: 'longbow', name: 'LONGBOW', slot: 'primary', price: 2700, damage: 34, head: 3.55,
mag: 30, reserve: 90, fireGap: 0.098, auto: true, reload: 2.35, falloff: 0.5,
spreadStill: 0.0014, spreadMove: 0.075, bloom: 0.0028, bloomMax: 0.04, recoil: 1.0,
pattern: [[-0.007, 0.002], [-0.010, -0.002], [-0.013, 0.004], [-0.015, -0.005], [-0.016, 0.005], [-0.014, -0.003], [-0.018, 0.006], [-0.020, -0.005], [-0.018, 0.004], [-0.022, -0.006]],
},
talon: {
id: 'talon', name: 'TALON', slot: 'primary', price: 4750, damage: 92, head: 2.4,
mag: 5, reserve: 20, fireGap: 1.25, auto: false, reload: 3.1, falloff: 0.2,
spreadStill: 0.0007, spreadMove: 0.11, bloom: 0.006, bloomMax: 0.03, recoil: 1.6,
pattern: [[-0.045, 0.008], [-0.052, -0.010], [-0.048, 0.012], [-0.055, -0.012]],
},
};
export const BUY_LIST = [
{ id: 'rattler', label: 'SMG', detail: 'RATTLER', price: 1250, kind: 'weapon' },
{ id: 'longbow', label: 'RIFLE', detail: 'LONGBOW', price: 2700, kind: 'weapon' },
{ id: 'talon', label: 'MARKSMAN', detail: 'TALON', price: 4750, kind: 'weapon' },
{ id: 'armor', label: 'KEVLAR', detail: 'BODY ARMOR', price: 650, kind: 'armor' },
{ id: 'helmet', label: 'HELMET', detail: 'KEVLAR + HELMET', price: 1000, kind: 'helmet' },
{ id: 'kit', label: 'KIT', detail: 'DEFUSE KIT', price: 400, kind: 'kit' },
{ id: 'frag', label: 'FRAG', detail: 'SHARD FRAG', price: 300, kind: 'grenade' },
{ id: 'flash', label: 'FLASH', detail: 'DAZZLER', price: 200, kind: 'grenade' },
{ id: 'smoke', label: 'SMOKE', detail: 'VEIL CANISTER', price: 300, kind: 'grenade' },
];
export function createGun(id) {
const def = WEAPONS[id] ?? WEAPONS.kestrel;
const gun = {
id: def.id,
def,
mag: def.mag,
reserve: def.reserve,
cooldown: 0,
reloadLeft: 0,
shotIndex: 0,
bloom: 0,
triggerHeld: false,
shotsSinceStep: 0,
};
return gun;
}
export function stepGun(gun, dt) {
gun.cooldown = Math.max(0, gun.cooldown - dt);
gun.bloom = Math.max(0, gun.bloom - dt * (gun.def.bloomMax > 0.03 ? 0.06 : 0.09));
if (gun.reloadLeft > 0) {
gun.reloadLeft = Math.max(0, gun.reloadLeft - dt);
if (gun.reloadLeft === 0) {
const need = gun.def.mag - gun.mag;
const take = Math.min(need, gun.reserve);
gun.mag += take;
gun.reserve -= take;
gun.shotIndex = 0;
}
}
}
export function gunReady(gun) {
return gun.mag > 0 && gun.cooldown <= 0 && gun.reloadLeft <= 0;
}
export function gunReload(gun) {
if (gun.reloadLeft > 0 || gun.mag >= gun.def.mag || gun.reserve === 0) return false;
gun.reloadLeft = gun.def.reload;
gun.shotIndex = 0;
return true;
}
export function gunFire(gun) {
if (!gunReady(gun)) return false;
gun.mag -= 1;
gun.cooldown = gun.def.fireGap;
gun.bloom = Math.min(gun.def.bloomMax, gun.bloom + gun.def.bloom);
const pattern = gun.def.pattern;
const kick = pattern[Math.min(gun.shotIndex, pattern.length - 1)];
gun.shotIndex += 1;
return kick;
}
export function gunSpread(gun, speed, crouching) {
const def = gun.def;
const move = Math.min(1, speed / 5.15);
const stance = crouching ? 0.62 : 1;
return (def.spreadStill * stance) + move * def.spreadMove + gun.bloom;
}
export function gunRefill(gun) {
gun.mag = gun.def.mag;
gun.reserve = gun.def.reserve;
gun.cooldown = 0;
gun.reloadLeft = 0;
gun.bloom = 0;
gun.shotIndex = 0;
}
function boxMesh(w, h, d, color, metalness = 0.2, roughness = 0.65) {
return new THREE.Mesh(
new THREE.BoxGeometry(w, h, d),
new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness, roughness }),
);
}
function buildModel(id) {
const group = new THREE.Group();
const steel = '#4e5b64';
const body = '#242d33';
const accent = PALETTE.accent;
const glove = '#5c4a39';
const hand = boxMesh(0.075, 0.075, 0.14, glove, 0.05, 0.9);
hand.position.set(0.025, -0.1, 0.02);
group.add(hand);
const hand2 = hand.clone();
hand2.position.set(-0.025, -0.045, id === 'kestrel' ? -0.12 : -0.44);
group.add(hand2);
if (id === 'kestrel') {
const slide = boxMesh(0.055, 0.075, 0.3, body, 0.5, 0.35);
slide.position.set(0, 0.02, -0.16);
const grip = boxMesh(0.05, 0.14, 0.08, steel, 0.2, 0.6);
grip.position.set(0, -0.08, 0.0);
grip.rotation.x = -0.22;
const sight = boxMesh(0.012, 0.02, 0.03, accent, 0.6, 0.3);
sight.position.set(0, 0.065, -0.24);
group.add(slide, grip, sight);
} else if (id === 'rattler') {
const receiver = boxMesh(0.075, 0.1, 0.4, steel, 0.45, 0.4);
receiver.position.set(0, 0.01, -0.16);
const barrel = boxMesh(0.035, 0.035, 0.2, body, 0.6, 0.3);
barrel.position.set(0, 0.03, -0.45);
const mag = boxMesh(0.05, 0.17, 0.09, body, 0.2, 0.7);
mag.position.set(0, -0.12, -0.08);
mag.rotation.x = 0.12;
const stock = boxMesh(0.06, 0.07, 0.2, steel, 0.2, 0.6);
stock.position.set(0, 0.0, 0.12);
const rail = boxMesh(0.016, 0.018, 0.22, accent, 0.7, 0.3);
rail.position.set(0, 0.075, -0.2);
group.add(receiver, barrel, mag, stock, rail);
} else if (id === 'longbow') {
const receiver = boxMesh(0.08, 0.11, 0.52, steel, 0.5, 0.35);
receiver.position.set(0, 0.01, -0.2);
const handguard = boxMesh(0.07, 0.07, 0.28, body, 0.2, 0.7);
handguard.position.set(0, 0.035, -0.52);
const barrel = boxMesh(0.03, 0.03, 0.22, steel, 0.8, 0.25);
barrel.position.set(0, 0.045, -0.74);
const mag = boxMesh(0.055, 0.18, 0.1, body, 0.2, 0.7);
mag.position.set(0, -0.12, -0.12);
mag.rotation.x = 0.18;
const stock = boxMesh(0.065, 0.09, 0.26, steel, 0.25, 0.55);
stock.position.set(0, -0.01, 0.14);
const rail = boxMesh(0.02, 0.02, 0.34, accent, 0.7, 0.3);
rail.position.set(0, 0.078, -0.26);
const sight = boxMesh(0.04, 0.045, 0.06, accent, 0.7, 0.3);
sight.position.set(0, 0.1, -0.16);
group.add(receiver, handguard, barrel, mag, stock, rail, sight);
} else {
const receiver = boxMesh(0.085, 0.12, 0.6, steel, 0.55, 0.3);
receiver.position.set(0, 0.01, -0.2);
const barrel = boxMesh(0.032, 0.032, 0.5, body, 0.8, 0.25);
barrel.position.set(0, 0.04, -0.76);
const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), metalness: 0.7, roughness: 0.3 }));
scope.rotation.x = Math.PI / 2;
scope.position.set(0, 0.115, -0.25);
const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.warden) }));
lens.position.set(0, 0.115, -0.39);
const stock = boxMesh(0.07, 0.1, 0.3, body, 0.25, 0.6);
stock.position.set(0, -0.01, 0.2);
const bipod = boxMesh(0.012, 0.18, 0.012, steel, 0.8, 0.3);
bipod.position.set(0, -0.1, -0.68);
group.add(receiver, barrel, scope, lens, stock, bipod);
}
group.traverse((child) => {
if (child.isMesh) {
child.castShadow = false;
child.receiveShadow = false;
}
});
return group;
}
export function createViewModel(camera) {
const models = {};
for (const id of Object.keys(WEAPONS)) {
const model = buildModel(id);
model.scale.setScalar(0.48);
model.visible = false;
camera.add(model);
models[id] = model;
}
const flash = new THREE.Mesh(
new THREE.OctahedronGeometry(0.055, 0),
new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
);
flash.visible = false;
camera.add(flash);
const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 0, 6, 2);
camera.add(flashLight);
const state = { active: 'kestrel', flash: 0, kick: 0, lowered: false, sway: 0, bob: 0, reloadAnim: 0, hidden: false };
const base = new THREE.Vector3(0.35, -0.24, -0.62);
function setActive(id) {
if (!models[id]) return;
for (const key of Object.keys(models)) models[key].visible = key === id && !state.hidden;
state.active = id;
}
function setHidden(hidden) {
state.hidden = hidden;
for (const key of Object.keys(models)) models[key].visible = key === state.active && !hidden;
}
function setMotion(speed, onGround, crouching) {
state.bob += speed * (crouching ? 0.9 : 1.25) * 0.016;
state.sway += (Math.min(1, speed / 5) - state.sway) * 0.1;
}
function update(dt, gun) {
state.flash = Math.max(0, state.flash - dt);
state.kick += (0 - state.kick) * Math.min(1, dt * 15);
state.reloadAnim = gun.reloadLeft > 0 ? Math.min(1, 1 - gun.reloadLeft / gun.def.reload) : 0;
const model = models[state.active];
if (!model) return;
const bobX = Math.cos(state.bob) * 0.012 * state.sway;
const bobY = Math.abs(Math.sin(state.bob)) * 0.011 * state.sway;
const targetY = base.y + bobY - (state.lowered ? 0.3 : 0);
model.position.set(base.x + bobX, targetY, base.z + state.kick * 0.06);
model.rotation.x = -0.05 + state.kick * 1.4 - state.reloadAnim * 0.7;
model.rotation.z = -0.12 + state.reloadAnim * 0.35;
model.rotation.y = 0.18 - state.reloadAnim * 0.3;
flash.visible = state.flash > 0 && !state.hidden;
if (state.flash > 0) {
model.updateMatrix();
flash.position.set(0, 0.04, { kestrel: -0.32, rattler: -0.56, longbow: -0.86, talon: -1.02 }[state.active]).applyMatrix4(model.matrix);
flash.rotation.z = state.flash * 47;
const scale = 1 + state.flash * 2.6;
flash.scale.set(scale * 0.5, scale * 0.5, scale * 1.6);
flash.material.opacity = Math.min(1, state.flash * 8);
flashLight.intensity = 12 * Math.min(1, state.flash * 14);
flashLight.position.copy(flash.position);
} else {
flashLight.intensity = 0;
}
}
function fire() {
state.flash = 0.055;
state.kick = 0.055;
}
setActive('kestrel');
return { state, setActive, setHidden, setMotion, update, fire, muzzle: new THREE.Vector3(0.25, -0.13, -0.95) };
}
