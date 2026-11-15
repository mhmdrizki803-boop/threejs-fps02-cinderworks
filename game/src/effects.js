import * as THREE from 'three';
import { PALETTE } from './palette.js';
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempDir = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1);
export function createEffects(scene) {
const tracers = [];
const decals = [];
const sparks = [];
const puffs = [];
const lights = [];
const smokeClouds = [];
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = smokeCanvas.height = 128;
const smokeCtx = smokeCanvas.getContext('2d');
const smokeGrad = smokeCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
smokeGrad.addColorStop(0, 'rgba(210,218,220,.9)');
smokeGrad.addColorStop(0.45, 'rgba(160,170,174,.6)');
smokeGrad.addColorStop(1, 'rgba(130,142,148,0)');
smokeCtx.fillStyle = smokeGrad;
smokeCtx.fillRect(0, 0, 128, 128);
const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
const smokeGeo = new THREE.PlaneGeometry(3.2, 3.2);
const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
for (let i = 0; i < 30; i += 1) {
const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
mesh.visible = false;
mesh.frustumCulled = false;
scene.add(mesh);
tracers.push({ mesh, life: 0, max: 0.11 });
}
const decalGeo = new THREE.CircleGeometry(0.11, 10);
for (let i = 0; i < 48; i += 1) {
const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.shadow), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const mesh = new THREE.Mesh(decalGeo, material);
mesh.visible = false;
scene.add(mesh);
decals.push({ mesh, life: 0, max: 22 });
}
const sparkGeo = new THREE.PlaneGeometry(0.05, 0.05);
for (let i = 0; i < 90; i += 1) {
const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const mesh = new THREE.Mesh(sparkGeo, material);
mesh.visible = false;
scene.add(mesh);
sparks.push({ mesh, life: 0, max: 0.4, velocity: new THREE.Vector3(), gravity: 9, size: 1 });
}
const puffGeo = new THREE.PlaneGeometry(0.5, 0.5);
for (let i = 0; i < 26; i += 1) {
const material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#a9b2b6'), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
const mesh = new THREE.Mesh(puffGeo, material);
mesh.visible = false;
scene.add(mesh);
puffs.push({ mesh, life: 0, max: 0.9, velocity: new THREE.Vector3(), sprite: true });
}
for (let i = 0; i < 4; i += 1) {
const light = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 0, 12, 2);
scene.add(light);
lights.push({ light, life: 0 });
}
let sparkCursor = 0;
let decalCursor = 0;
let tracerCursor = 0;
let puffCursor = 0;
let lightCursor = 0;
function spawnTracer(from, to, color = PALETTE.hazard) {
const item = tracers[tracerCursor];
tracerCursor = (tracerCursor + 1) % tracers.length;
tempDir.subVectors(to, from);
const length = tempDir.length();
if (length < 0.05) return;
tempDir.normalize();
item.mesh.position.copy(from).addScaledVector(tempDir, length * 0.5);
item.mesh.quaternion.setFromUnitVectors(zAxis, tempDir);
item.mesh.scale.set(1, 1, length);
item.mesh.material.color.set(color);
item.mesh.material.opacity = 0.9;
item.mesh.visible = true;
item.life = item.max;
}
function spawnDecal(point, normal, color = PALETTE.shadow) {
const item = decals[decalCursor];
decalCursor = (decalCursor + 1) % decals.length;
item.mesh.position.copy(point).addScaledVector(normal, 0.012);
item.mesh.quaternion.setFromUnitVectors(zAxis, normal);
const scale = 0.8 + Math.random() * 0.7;
item.mesh.scale.set(scale, scale, scale);
item.mesh.material.color.set(color);
item.mesh.material.opacity = 0.85;
item.mesh.visible = true;
item.life = item.max;
}
function spawnSparkBurst(point, normal, color, count = 7, speed = 4) {
for (let i = 0; i < count; i += 1) {
const item = sparks[sparkCursor];
sparkCursor = (sparkCursor + 1) % sparks.length;
item.mesh.position.copy(point);
tempA.set(normal.x + (Math.random() * 2 - 1) * 0.9, normal.y + Math.random() * 1.2 + 0.2, normal.z + (Math.random() * 2 - 1) * 0.9).normalize();
item.velocity.copy(tempA).multiplyScalar(speed * (0.4 + Math.random() * 0.9));
item.life = item.max * (0.5 + Math.random() * 0.7);
item.max = item.life;
item.size = 0.5 + Math.random() * 1.4;
item.mesh.scale.setScalar(item.size);
item.mesh.material.color.set(color);
item.mesh.material.opacity = 1;
item.mesh.visible = true;
}
}
function impact(point, normal) {
spawnSparkBurst(point, normal, PALETTE.hazard, 6, 3.6);
spawnDecal(point, normal);
}
function blood(point, direction) {
spawnSparkBurst(point, direction, '#b3382c', 7, 2.4);
const item = puffs[puffCursor];
puffCursor = (puffCursor + 1) % puffs.length;
item.mesh.position.copy(point);
item.mesh.lookAt(point.x + direction.x, point.y + direction.y, point.z + direction.z);
item.velocity.copy(direction).multiplyScalar(-0.4);
item.life = 0.45;
item.max = 0.45;
item.mesh.material.color.set('#7e2a21');
item.mesh.material.opacity = 0.5;
item.mesh.scale.setScalar(1);
item.mesh.visible = true;
}
function muzzle(point) {
spawnSparkBurst(point, new THREE.Vector3(0, 0.2, 1), PALETTE.hazard, 2, 2);
}
function explosion(point) {
spawnSparkBurst(point, new THREE.Vector3(0, 1, 0), PALETTE.hazard, 18, 8);
for (let i = 0; i < 6; i += 1) {
const item = puffs[puffCursor];
puffCursor = (puffCursor + 1) % puffs.length;
item.mesh.position.copy(point);
item.mesh.position.x += (Math.random() * 2 - 1) * 0.6;
item.mesh.position.y += 0.4 + Math.random() * 0.8;
item.mesh.position.z += (Math.random() * 2 - 1) * 0.6;
item.velocity.set((Math.random() * 2 - 1) * 0.9, 1.5 + Math.random(), (Math.random() * 2 - 1) * 0.9);
item.life = 1.6;
item.max = 1.6;
item.mesh.material.color.set('#6d6560');
item.mesh.material.opacity = 0.5;
item.mesh.scale.setScalar(2 + Math.random() * 2);
item.mesh.visible = true;
}
const light = lights[lightCursor];
lightCursor = (lightCursor + 1) % lights.length;
light.life = 0.35;
light.light.color.set(PALETTE.hazard);
light.light.position.copy(point);
light.light.intensity = 34;
}
function flashBurst(point) {
spawnSparkBurst(point, new THREE.Vector3(0, 1, 0), '#ffffff', 24, 9);
const light = lights[lightCursor];
lightCursor = (lightCursor + 1) % lights.length;
light.life = 0.45;
light.light.color.set('#ffffff');
light.light.position.copy(point);
light.light.intensity = 60;
}
function smoke(point) {
const group = new THREE.Group();
group.position.copy(point);
const cloud = { group, center: point.clone(), radius: 2.45, life: 13, max: 13, puffs: [] };
for (let i = 0; i < 12; i += 1) {
const material = new THREE.MeshBasicMaterial({
map: smokeTexture, color: new THREE.Color('#aeb6b9'), transparent: true,
opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
});
const mesh = new THREE.Mesh(smokeGeo, material);
mesh.position.set((Math.random() * 2 - 1) * 1.8, 0.5 + Math.random() * 2.1, (Math.random() * 2 - 1) * 1.8);
mesh.scale.setScalar(0.7 + Math.random() * 0.75);
group.add(mesh);
cloud.puffs.push({ mesh, baseY: mesh.position.y, phase: Math.random() * 6.28 });
}
scene.add(group);
smokeClouds.push(cloud);
while (smokeClouds.length > 4) {
const old = smokeClouds.shift();
scene.remove(old.group);
for (const item of old.puffs) item.mesh.material.dispose();
}
}
function smokeBlocks(x1, z1, x2, z2) {
const dx = x2 - x1;
const dz = z2 - z1;
const lengthSq = dx * dx + dz * dz || 1;
for (const cloud of smokeClouds) {
const t = Math.max(0, Math.min(1, ((cloud.center.x - x1) * dx + (cloud.center.z - z1) * dz) / lengthSq));
const px = x1 + dx * t - cloud.center.x;
const pz = z1 + dz * t - cloud.center.z;
if (px * px + pz * pz < cloud.radius * cloud.radius) return true;
}
return false;
}
function freeze() {
for (const item of tracers) if (item.mesh.visible) item.life = item.max = 8;
for (const item of sparks) if (item.mesh.visible) item.life = item.max = 8;
for (const item of puffs) if (item.mesh.visible) item.life = item.max = 8;
for (const item of decals) if (item.mesh.visible) item.life = item.max = 40;
for (const item of lights) if (item.life > 0) item.life = 8;
}
function update(dt) {
for (const item of tracers) {
if (item.life <= 0) continue;
item.life -= dt;
item.mesh.material.opacity = Math.max(0, item.life / item.max) * 0.9;
if (item.life <= 0) item.mesh.visible = false;
}
for (const item of decals) {
if (item.life <= 0) continue;
item.life -= dt;
if (item.life <= 0) item.mesh.visible = false;
}
for (const item of sparks) {
if (item.life <= 0) continue;
item.life -= dt;
item.velocity.y -= item.gravity * dt;
item.mesh.position.addScaledVector(item.velocity, dt);
const fade = Math.max(0, item.life / item.max);
item.mesh.material.opacity = fade;
item.mesh.quaternion.copy(cameraQuat);
if (item.life <= 0) item.mesh.visible = false;
}
for (const item of puffs) {
if (item.life <= 0) continue;
item.life -= dt;
item.mesh.position.addScaledVector(item.velocity, dt);
const fade = Math.max(0, item.life / item.max);
item.mesh.material.opacity = fade * 0.45;
if (item.life <= 0) item.mesh.visible = false;
}
for (const item of lights) {
if (item.life <= 0) continue;
item.life -= dt;
item.light.intensity = Math.max(0, item.life * 90);
}
for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
const cloud = smokeClouds[i];
cloud.life -= dt;
const fade = Math.min(1, cloud.life / 2.2, (cloud.max - cloud.life) / 0.45);
for (const item of cloud.puffs) {
item.phase += dt * 0.35;
item.mesh.position.y = item.baseY + Math.sin(item.phase) * 0.18;
item.mesh.quaternion.copy(cameraQuat);
item.mesh.material.opacity = Math.max(0, fade) * 0.3;
}
if (cloud.life <= 0) {
scene.remove(cloud.group);
for (const item of cloud.puffs) item.mesh.material.dispose();
smokeClouds.splice(i, 1);
}
}
}
const cameraQuat = new THREE.Quaternion();
function setCameraQuaternion(quat) {
cameraQuat.copy(quat);
}
function clear() {
for (const item of tracers) { item.life = 0; item.mesh.visible = false; }
for (const item of decals) { item.life = 0; item.mesh.visible = false; }
for (const item of sparks) { item.life = 0; item.mesh.visible = false; }
for (const item of puffs) { item.life = 0; item.mesh.visible = false; }
for (const item of lights) { item.life = 0; item.light.intensity = 0; }
for (const cloud of smokeClouds) {
scene.remove(cloud.group);
for (const item of cloud.puffs) item.mesh.material.dispose();
}
smokeClouds.length = 0;
}
return { spawnTracer, impact, blood, muzzle, explosion, flashBurst, smoke, smokeBlocks, update, setCameraQuaternion, clear, freeze };
}
