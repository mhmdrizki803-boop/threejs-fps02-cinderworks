// Foundry map: geometry, canvas textures, lighting and the 44x44 navigation/sight grids.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
export const BOUNDS = 22;
const CELL = 1;
const COLS = 44;
function noiseTexture(size, base, line, alpha) {
const canvas = document.createElement('canvas');
canvas.width = size;
canvas.height = size;
const ctx = canvas.getContext('2d');
ctx.fillStyle = base;
ctx.fillRect(0, 0, size, size);
for (let i = 0; i < 900; i += 1) {
const shade = 12 + Math.floor(Math.random() * 26);
ctx.fillStyle = `rgba(${shade},${shade + 3},${shade + 4},0.16)`;
ctx.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
}
ctx.strokeStyle = line;
ctx.globalAlpha = alpha;
ctx.lineWidth = 2;
for (let p = 0; p <= size; p += size / 4) {
ctx.beginPath();
ctx.moveTo(p, 0);
ctx.lineTo(p, size);
ctx.moveTo(0, p);
ctx.lineTo(size, p);
ctx.stroke();
}
ctx.globalAlpha = 1;
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;
return texture;
}
function siteTexture() {
const canvas = document.createElement('canvas');
canvas.width = 512;
canvas.height = 512;
const ctx = canvas.getContext('2d');
ctx.clearRect(0, 0, 512, 512);
ctx.strokeStyle = PALETTE.hazard;
ctx.lineWidth = 12;
ctx.beginPath();
ctx.arc(256, 256, 210, 0, Math.PI * 2);
ctx.stroke();
ctx.lineWidth = 4;
ctx.beginPath();
ctx.arc(256, 256, 178, 0, Math.PI * 2);
ctx.stroke();
ctx.fillStyle = PALETTE.hazard;
ctx.font = 'bold 132px monospace';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('A', 256, 250);
ctx.font = 'bold 34px monospace';
ctx.fillText('PULSE SITE', 256, 350);
for (let a = 0; a < 8; a += 1) {
ctx.save();
ctx.translate(256, 256);
ctx.rotate((a * Math.PI) / 4);
ctx.fillRect(-8, -240, 16, 34);
ctx.restore();
}
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;
return texture;
}
function signTexture() {
const canvas = document.createElement('canvas');
canvas.width = 512;
canvas.height = 128;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#141b1f';
ctx.fillRect(0, 0, 512, 128);
ctx.fillStyle = PALETTE.hazard;
for (let i = 0; i < 5; i += 1) {
ctx.fillRect(i * 18, 0, 8, 14);
ctx.fillRect(512 - 18 - i * 18, 114, 8, 14);
}
ctx.strokeStyle = 'rgba(240,192,74,0.55)';
ctx.lineWidth = 3;
ctx.strokeRect(6, 6, 500, 116);
ctx.fillStyle = '#f0d9a0';
ctx.font = 'bold 46px monospace';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('PULSE CORE', 256, 53);
ctx.fillStyle = PALETTE.hazard;
ctx.font = 'bold 17px monospace';
ctx.fillText('SITE A // COOLANT LOOP', 256, 92);
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;
return texture;
}
function hazardTexture() {
const canvas = document.createElement('canvas');
canvas.width = 128;
canvas.height = 128;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#1b1d1c';
ctx.fillRect(0, 0, 128, 128);
ctx.fillStyle = PALETTE.hazard;
for (let i = -128; i < 256; i += 48) {
ctx.beginPath();
ctx.moveTo(i, 0);
ctx.lineTo(i + 24, 0);
ctx.lineTo(i + 24 + 128, 128);
ctx.lineTo(i + 128, 128);
ctx.closePath();
ctx.fill();
}
const texture = new THREE.CanvasTexture(canvas);
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
texture.colorSpace = THREE.SRGBColorSpace;
return texture;
}
export function createMap(scene) {
const group = new THREE.Group();
scene.add(group);
const concreteMap = noiseTexture(256, '#6c7a82', '#3b474d', 0.5);
concreteMap.wrapS = concreteMap.wrapT = THREE.RepeatWrapping;
concreteMap.repeat.set(14, 14);
const crateMap = noiseTexture(256, '#65727a', '#38434a', 0.45);
crateMap.wrapS = crateMap.wrapT = THREE.RepeatWrapping;
const materials = {
floor: new THREE.MeshStandardMaterial({ color: '#c3ced4', map: concreteMap, roughness: 0.94, metalness: 0.04 }),
wall: new THREE.MeshStandardMaterial({ color: '#7c8b93', roughness: 0.85, metalness: 0.12 }),
steel: new THREE.MeshStandardMaterial({ color: '#6b7b85', roughness: 0.55, metalness: 0.45 }),
crate: new THREE.MeshStandardMaterial({ color: '#b9c5cb', map: crateMap, roughness: 0.8, metalness: 0.15 }),
hazard: new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.6, metalness: 0.2, emissive: new THREE.Color(PALETTE.hazard).multiplyScalar(0.12) }),
glow: new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.4, roughness: 0.4 }),
warden: new THREE.MeshStandardMaterial({ color: PALETTE.warden, emissive: new THREE.Color(PALETTE.warden), emissiveIntensity: 1.2, roughness: 0.4 }),
dark: new THREE.MeshStandardMaterial({ color: '#263137', roughness: 0.9, metalness: 0.2 }),
marking: new THREE.MeshStandardMaterial({ color: '#a88948', roughness: 0.85, metalness: 0.05 }),
panel: new THREE.MeshStandardMaterial({ color: '#3d4c55', roughness: 0.82, metalness: 0.14 }),
};
const colliders = [];
const obstacles = [];
const shootables = [];
function box(w, h, d, x, y, z, material, options = {}) {
const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
mesh.position.set(x, y, z);
mesh.castShadow = options.castShadow !== false;
mesh.receiveShadow = true;
group.add(mesh);
const bounds = new THREE.Box3().setFromObject(mesh);
if (options.collide !== false) {
colliders.push(bounds);
if (options.obstacle !== false) obstacles.push(bounds);
}
shootables.push(mesh);
return mesh;
}
function obstacle(w, h, d, x, z, material = materials.crate, trim = true) {
const mesh = box(w, h, d, x, h / 2, z, material);
if (trim) {
const stripe = box(w + 0.04, 0.08, d + 0.04, x, h - 0.1, z, materials.hazard, { collide: false, obstacle: false, castShadow: false });
stripe.raycast = () => {};
}
return mesh;
}
// Ground and the four perimeter walls.
box(45, 0.5, 45, 0, -0.25, 0, materials.floor, { castShadow: false, obstacle: false });
box(44.4, 5.4, 1, 0, 2.7, -22, materials.wall);
box(44.4, 5.4, 1, 0, 2.7, 22, materials.wall);
box(1, 5.4, 44.4, -22, 2.7, 0, materials.wall);
box(1, 5.4, 44.4, 22, 2.7, 0, materials.wall);
// Low trim lights along the perimeter so the walls read at a distance.
for (const z of [-14, 0, 14]) {
box(0.12, 0.1, 5, -21.44, 1.05, z, materials.glow, { collide: false, obstacle: false, castShadow: false });
box(0.12, 0.1, 5, 21.44, 1.05, z, materials.glow, { collide: false, obstacle: false, castShadow: false });
}
for (const x of [-14, 0, 14]) {
box(5, 0.1, 0.12, x, 1.05, -21.44, materials.glow, { collide: false, obstacle: false, castShadow: false });
box(5, 0.1, 0.12, x, 1.05, 21.44, materials.warden, { collide: false, obstacle: false, castShadow: false });
}
// Lane dividers: a west and an east wall, each with a doorway that opens onto the north yard.
for (const side of [-1, 1]) {
box(1, 4.6, 12, side * 10, 2.3, -16, materials.wall);
box(1, 4.6, 4, side * 10, 2.3, -4, materials.wall);
}
// The furnace: the map's landmark, a hot block with a chimney and breathing vents.
box(7, 4.4, 6, 0, 2.2, -13, materials.steel);
box(7.4, 0.5, 6.4, 0, 0.25, -13, materials.dark);
box(7.4, 0.35, 6.4, 0, 4.5, -13, materials.hazard, { collide: false, obstacle: false });
for (const side of [-1, 1]) {
box(0.16, 1.5, 3.6, side * 3.54, 2.1, -13, materials.glow, { collide: false, obstacle: false, castShadow: false });
}
const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 6.5, 16), materials.steel);
chimney.position.set(0, 7.1, -13);
chimney.castShadow = true;
group.add(chimney);
const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.35, 16), materials.glow);
cap.position.set(0, 10.4, -13);
group.add(cap);
// Site cover: crates you can crouch behind around the pulse pad.
obstacle(1.7, 1.25, 1.7, -3.8, -1.0);
obstacle(1.7, 1.25, 1.7, 3.9, -2.1);
obstacle(2.6, 0.95, 1.3, 0.3, -7.0);
obstacle(1.2, 1.5, 1.2, -1.7, -6.6);
// Mid approach and spawn cover.
obstacle(3.6, 1.2, 1.2, -1.5, 11.5);
obstacle(1.3, 1.35, 3.1, 6.2, 6.0);
obstacle(1.3, 1.0, 1.3, -6.8, 4.2);
obstacle(2.2, 1.15, 1.2, 0.8, 1.8);
// West lane cover and a stack of pipes.
obstacle(2.2, 1.1, 1.3, -16.5, 12.0);
obstacle(1.3, 1.45, 3.2, -18.2, 1.5);
obstacle(1.5, 0.95, 1.5, -14.0, -4.2);
box(0.55, 2.6, 0.55, -20.2, 1.3, -8.5, materials.steel);
box(0.55, 2.6, 0.55, -20.2, 1.3, 6.5, materials.steel);
// East lane cover.
obstacle(1.3, 1.2, 2.3, 16.2, 9.5);
obstacle(3.1, 1.45, 1.3, 18.2, -1.2);
obstacle(1.5, 0.95, 1.5, 14.0, -4.4);
box(0.55, 2.6, 0.55, 20.2, 1.3, -6.5, materials.steel);
box(0.55, 2.6, 0.55, 20.2, 1.3, 8.5, materials.steel);
// North spawn cover.
obstacle(1.8, 1.2, 1.8, -6.4, -19.0);
obstacle(1.8, 1.2, 1.8, 6.4, -19.0);
obstacle(1.3, 1.0, 3.2, -13.5, -16.0);
obstacle(1.3, 1.0, 3.2, 13.5, -16.0);
const site = { x: 0, z: -4, radius: 4.3 };
const ring = new THREE.Mesh(
new THREE.PlaneGeometry(9.4, 9.4),
new THREE.MeshBasicMaterial({ map: siteTexture(), transparent: true, depthWrite: false, opacity: 0.92 }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.set(site.x, 0.012, site.z);
group.add(ring);
const pad = new THREE.Mesh(
new THREE.CylinderGeometry(1.5, 1.5, 0.16, 24),
materials.dark,
);
pad.position.set(site.x, 0.08, site.z);
pad.receiveShadow = true;
group.add(pad);
const padGlow = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.05, 8, 32), materials.hazard);
padGlow.rotation.x = Math.PI / 2;
padGlow.position.set(site.x, 0.18, site.z);
group.add(padGlow);
// Wall panels, a service pipe and floor guide lines break up the grey faces.
for (const x of [-17, -11, 11, 17]) {
box(4.6, 2.5, 0.07, x, 2.8, -21.44, materials.panel, { collide: false, obstacle: false, castShadow: false });
box(4.6, 2.5, 0.07, x, 2.8, 21.44, materials.panel, { collide: false, obstacle: false, castShadow: false });
}
for (const z of [-16, -8, 0, 8, 16]) {
box(0.07, 2.5, 5.4, -21.44, 2.8, z, materials.panel, { collide: false, obstacle: false, castShadow: false });
box(0.07, 2.5, 5.4, 21.44, 2.8, z, materials.panel, { collide: false, obstacle: false, castShadow: false });
}
for (const side of [-1, 1]) {
const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 42, 8), materials.steel);
pipe.rotation.z = Math.PI / 2;
pipe.position.set(0, 3.95, side * 21.2);
pipe.castShadow = true;
group.add(pipe);
for (const x of [-18, -9, 0, 9, 18]) {
box(0.3, 0.5, 0.3, x, 3.75, side * 21.2, materials.dark, { collide: false, obstacle: false, castShadow: false });
}
}
for (const x of [-2.3, 2.3]) {
for (let z = 2.4; z <= 14.2; z += 2.2) {
box(0.12, 0.012, 1.25, x, 0.008, z, materials.marking, { collide: false, obstacle: false, castShadow: false });
}
}
for (const [x, z] of [[-19.4, -17.2], [19.1, 15.2], [-19.2, 15.6]]) {
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.94, 10), materials.dark);
barrel.position.set(x, 0.47, z);
barrel.castShadow = true;
group.add(barrel);
const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 10), materials.hazard);
band.position.set(x, 0.64, z);
group.add(band);
}
const sign = new THREE.Mesh(
new THREE.PlaneGeometry(5.4, 1.35),
new THREE.MeshBasicMaterial({ map: signTexture(), color: new THREE.Color('#c8bda4') }),
);
sign.position.set(0, 3.72, -9.96);
group.add(sign);
// Lamp posts: warm at the site, cold along the lanes.
const lampSpots = [
[0, -8.5, PALETTE.accent, 16],
[-16, 3, PALETTE.accent, 9],
[16, 3, PALETTE.accent, 9],
[0, 15, PALETTE.warden, 7],
[0, -19, PALETTE.warden, 7],
];
for (const [x, z, color, intensity] of lampSpots) {
const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.2, 8), materials.steel);
post.position.set(x, 2.1, z);
post.castShadow = true;
group.add(post);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 2 }));
bulb.position.set(x, 4.25, z);
group.add(bulb);
const light = new THREE.PointLight(new THREE.Color(color), intensity * 1.7, 15, 1.8);
light.position.set(x, 4.1, z);
group.add(light);
}
// Sky: a cold gradient above the yard and a low sun behind the furnace.
const sky = new THREE.Mesh(
new THREE.SphereGeometry(90, 24, 16),
new THREE.MeshBasicMaterial({ color: new THREE.Color('#152832'), side: THREE.BackSide, fog: false }),
);
scene.add(sky);
scene.background = new THREE.Color('#101b21');
scene.fog = new THREE.Fog(new THREE.Color('#17242b'), 34, 98);
const hemi = new THREE.HemisphereLight(new THREE.Color('#b8d2df'), new THREE.Color('#4a3d2e'), 1.85);
scene.add(hemi);
const ambient = new THREE.AmbientLight(new THREE.Color('#8ea3b0'), 0.32);
scene.add(ambient);
const key = new THREE.DirectionalLight(new THREE.Color('#ffe0b0'), 2.7);
key.position.set(-14, 22, -8);
key.target.position.set(0, 0, -4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -26;
key.shadow.camera.right = 26;
key.shadow.camera.top = 26;
key.shadow.camera.bottom = -26;
key.shadow.camera.far = 70;
key.shadow.bias = -0.0007;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(new THREE.Color('#7fa8c0'), 1.2);
fill.position.set(16, 12, 18);
scene.add(fill);
const siteLight = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 18, 18, 1.8);
siteLight.position.set(0, 3.2, -4);
group.add(siteLight);
// Coloured smoke stacks in the far skyline, purely cosmetic.
for (const [x, z, h] of [[-18, -24, 12], [14, -25, 9]]) {
const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, h, 10), materials.dark);
stack.position.set(x, h / 2, z);
group.add(stack);
}
// --- Navigation grid -----------------------------------------------------
const navSolid = new Uint8Array(COLS * COLS);
const sightSolid = new Uint8Array(COLS * COLS);
const min = -BOUNDS;
function cellIndex(ix, iz) {
return iz * COLS + ix;
}
function markGrid(grid, expand) {
for (const box3 of obstacles) {
const height = box3.max.y - box3.min.y;
const x0 = Math.floor(box3.min.x - expand + BOUNDS);
const x1 = Math.floor(box3.max.x + expand + BOUNDS);
const z0 = Math.floor(box3.min.z - expand + BOUNDS);
const z1 = Math.floor(box3.max.z + expand + BOUNDS);
for (let iz = Math.max(0, z0); iz <= Math.min(COLS - 1, z1); iz += 1) {
for (let ix = Math.max(0, x0); ix <= Math.min(COLS - 1, x1); ix += 1) {
if (height > 0.4) grid[cellIndex(ix, iz)] = 1;
}
}
}
}
markGrid(navSolid, 0.42);
for (const box3 of obstacles) {
if (box3.max.y < 1.45) continue;
const x0 = Math.floor(box3.min.x + BOUNDS);
const x1 = Math.floor(box3.max.x + BOUNDS);
const z0 = Math.floor(box3.min.z + BOUNDS);
const z1 = Math.floor(box3.max.z + BOUNDS);
for (let iz = Math.max(0, z0); iz <= Math.min(COLS - 1, z1); iz += 1) {
for (let ix = Math.max(0, x0); ix <= Math.min(COLS - 1, x1); ix += 1) sightSolid[cellIndex(ix, iz)] = 1;
}
}
function solidCell(ix, iz) {
if (ix < 0 || iz < 0 || ix >= COLS || iz >= COLS) return true;
return navSolid[cellIndex(ix, iz)] === 1;
}
function isSolid(x, z) {
return solidCell(Math.floor(x + BOUNDS), Math.floor(z + BOUNDS));
}
function worldToCell(x, z) {
return {
ix: Math.max(0, Math.min(COLS - 1, Math.floor(x + BOUNDS))),
iz: Math.max(0, Math.min(COLS - 1, Math.floor(z + BOUNDS))),
};
}
function cellCenter(ix, iz) {
return { x: min + (ix + 0.5) * CELL, z: min + (iz + 0.5) * CELL };
}
function nearestOpen(x, z) {
const start = worldToCell(x, z);
if (!solidCell(start.ix, start.iz)) return start;
let best = start;
let bestDist = Infinity;
for (let radius = 1; radius <= 6; radius += 1) {
for (let dz = -radius; dz <= radius; dz += 1) {
for (let dx = -radius; dx <= radius; dx += 1) {
if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
const ix = start.ix + dx;
const iz = start.iz + dz;
if (solidCell(ix, iz)) continue;
const dist = dx * dx + dz * dz;
if (dist < bestDist) {
bestDist = dist;
best = { ix, iz };
}
}
}
if (bestDist < Infinity) return best;
}
return best;
}
const NEIGHBORS = [
[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
[1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];
// A* on the 1 m grid. Grids are small (44 x 44) so flat typed arrays beat cleverness.
function findPath(fromX, fromZ, toX, toZ) {
const start = nearestOpen(fromX, fromZ);
const goal = nearestOpen(toX, toZ);
if (start.ix === goal.ix && start.iz === goal.iz) {
const point = cellCenter(goal.ix, goal.iz);
return [point];
}
const total = COLS * COLS;
const g = new Float32Array(total).fill(Infinity);
const f = new Float32Array(total).fill(Infinity);
const came = new Int32Array(total).fill(-1);
const closed = new Uint8Array(total);
const open = [];
const startIndex = start.iz * COLS + start.ix;
const goalIndex = goal.iz * COLS + goal.ix;
g[startIndex] = 0;
f[startIndex] = heuristic(start.ix, start.iz, goal.ix, goal.iz);
open.push(startIndex);
let guard = 0;
while (open.length && guard < 4000) {
guard += 1;
let best = 0;
for (let i = 1; i < open.length; i += 1) if (f[open[i]] < f[open[best]]) best = i;
const current = open.splice(best, 1)[0];
if (current === goalIndex) break;
if (closed[current]) continue;
closed[current] = 1;
const cx = current % COLS;
const cz = (current - cx) / COLS;
for (const [dx, dz, cost] of NEIGHBORS) {
const nx = cx + dx;
const nz = cz + dz;
if (solidCell(nx, nz)) continue;
if (dx !== 0 && dz !== 0 && (solidCell(cx + dx, cz) || solidCell(cx, cz + dz))) continue;
const index = nz * COLS + nx;
if (closed[index]) continue;
const tentative = g[current] + cost;
if (tentative < g[index]) {
g[index] = tentative;
const h = heuristic(nx, nz, goal.ix, goal.iz);
f[index] = tentative + h;
came[index] = current;
open.push(index);
}
}
}
if (came[goalIndex] === -1 && goalIndex !== startIndex) return [];
const path = [];
let node = goalIndex;
let steps = 0;
while (node !== -1 && steps < 300) {
const ix = node % COLS;
const iz = (node - ix) / COLS;
path.push(cellCenter(ix, iz));
node = came[node];
steps += 1;
}
path.reverse();
path.shift();
return path;
}
function heuristic(ax, az, bx, bz) {
const dx = Math.abs(ax - bx);
const dz = Math.abs(az - bz);
return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
}
function lineOfSight(ax, az, bx, bz) {
const dx = bx - ax;
const dz = bz - az;
const distance = Math.hypot(dx, dz);
const steps = Math.max(1, Math.ceil(distance / 0.22));
for (let i = 1; i < steps; i += 1) {
const t = i / steps;
const ix = Math.floor(ax + dx * t + BOUNDS);
const iz = Math.floor(az + dz * t + BOUNDS);
if (ix < 0 || iz < 0 || ix >= COLS || iz >= COLS) return false;
if (sightSolid[iz * COLS + ix]) return false;
}
return true;
}
// Walls are tall enough to see over the crates, so a bullet may clear a box the grid flags.
const ray = new THREE.Ray();
const hitPoint = new THREE.Vector3();
const wallDistance = (origin, direction, maxDistance) => {
ray.origin.copy(origin);
ray.direction.copy(direction);
let nearest = maxDistance;
for (const box3 of colliders) {
const point = ray.intersectBox(box3, hitPoint);
if (!point) continue;
const distance = point.distanceTo(origin);
if (distance > 0.05 && distance < nearest) nearest = distance;
}
return nearest;
};
const spawns = {
ember: [
{ x: 0, z: 18.5 }, { x: -4, z: 18 }, { x: 4, z: 18 },
{ x: -8, z: 17 }, { x: 8, z: 17 },
],
warden: [
{ x: 0, z: -18.5 }, { x: -6, z: -17.5 }, { x: 6, z: -17.5 },
{ x: -10.5, z: -16 }, { x: 10.5, z: -16 },
],
};
return {
group,
colliders,
obstacles,
shootables,
site,
spawns,
bounds: BOUNDS,
materials,
isSolid,
findPath,
nearestOpen,
lineOfSight,
wallDistance,
worldToCell,
cellCenter,
navSolid,
COLS,
};
}
