export function createMover(colliders) {
const solid = colliders.filter((box) => box.max.y - box.min.y > 0.3);
function overlaps(x, y, z, radius, height, lift = 0) {
for (const box of solid) {
if (x + radius <= box.min.x || x - radius >= box.max.x) continue;
if (z + radius <= box.min.z || z - radius >= box.max.z) continue;
if (y + height - lift <= box.min.y || y + lift >= box.max.y) continue;
return box;
}
return null;
}
function moveXZ(x, z, dx, dz, radius, height) {
const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.16));
const sx = dx / steps;
const sz = dz / steps;
let px = x;
let pz = z;
for (let i = 0; i < steps; i += 1) {
if (!overlaps(px + sx, 0.05, pz, radius, height, 0.06)) px += sx;
if (!overlaps(px, 0.05, pz + sz, radius, height, 0.06)) pz += sz;
}
return { x: px, z: pz };
}
return { overlaps, moveXZ };
}
