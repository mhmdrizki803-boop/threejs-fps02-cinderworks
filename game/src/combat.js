// Hitscan against head spheres, body boxes and map colliders.
import * as THREE from 'three';

const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();
const point = new THREE.Vector3();
const result = {
  kind: 'none', entity: null, part: 'body', point: new THREE.Vector3(), distance: 0, normal: new THREE.Vector3(), wall: false,
};

function sphereHit(origin, direction, center, radius, maxDistance) {
  // Ray/sphere from the standard quadratic; returns distance or Infinity.
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const t = -b - root;
  if (t >= 0 && t <= maxDistance) return t;
  const t2 = -b + root;
  if (t2 >= 0 && t2 <= maxDistance) return t2;
  return Infinity;
}

function boxHit(origin, direction, min, max, maxDistance) {
  let tmin = 0;
  let tmax = maxDistance;
  for (const axis of ['x', 'y', 'z']) {
    const d = direction[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < min[axis] || o > max[axis]) return Infinity;
    } else {
      let t1 = (min[axis] - o) / d;
      let t2 = (max[axis] - o) / d;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

const bodyMin = new THREE.Vector3();
const bodyMax = new THREE.Vector3();
const headCenter = new THREE.Vector3();

export function castShot(origin, direction, maxDistance, shooterTeam, entities, map) {
  const wallDistance = map.wallDistance(origin, direction, maxDistance);
  let nearest = wallDistance;
  result.kind = 'wall';
  result.entity = null;
  result.wall = true;
  result.part = 'body';
  result.distance = wallDistance;
  result.point.copy(origin).addScaledVector(direction, wallDistance);
  result.normal.copy(direction).multiplyScalar(-1);

  for (const entity of entities) {
    if (!entity || !entity.alive || entity.team === shooterTeam) continue;
    const height = entity.height ?? 1.76;
    const feet = entity.position;
    headCenter.set(feet.x, feet.y + height - 0.16, feet.z);
    const headDistance = sphereHit(origin, direction, headCenter, 0.19, Math.min(nearest, maxDistance));
    bodyMin.set(feet.x - 0.29, feet.y + 0.22, feet.z - 0.29);
    bodyMax.set(feet.x + 0.29, feet.y + height - 0.34, feet.z + 0.29);
    const bodyDistance = boxHit(origin, direction, bodyMin, bodyMax, Math.min(nearest, maxDistance));
    let hitDistance = Infinity;
    let part = 'body';
    if (headDistance < hitDistance) { hitDistance = headDistance; part = 'head'; }
    if (bodyDistance < hitDistance) { hitDistance = bodyDistance; part = 'body'; }
    if (hitDistance < nearest) {
      nearest = hitDistance;
      result.kind = 'entity';
      result.entity = entity;
      result.part = part;
      result.wall = false;
      result.distance = hitDistance;
      result.point.copy(origin).addScaledVector(direction, hitDistance);
      result.normal.copy(direction).multiplyScalar(-1);
    }
  }
  return result;
}

export function damageFor(def, distance, part) {
  const drop = Math.max(0, Math.min(1, (distance - 14) / 42));
  const falloff = 1 - def.falloff * drop;
  const head = part === 'head' ? def.head : 1;
  return def.damage * falloff * head;
}

const coneA = new THREE.Vector3();
const coneB = new THREE.Vector3();
const coneUp = new THREE.Vector3(0, 1, 0);

// Applies a symmetric cone of error to a direction. Spread is the tangent of the half-angle.
export function spreadDirection(direction, spread, rng, out) {
  coneA.set(0, 0, 0);
  coneB.set(0, 0, 0);
  if (Math.abs(direction.y) < 0.95) coneA.crossVectors(direction, coneUp).normalize();
  else coneA.set(1, 0, 0);
  coneB.crossVectors(direction, coneA).normalize();
  const angle = rng() * Math.PI * 2;
  const radius = Math.sqrt(rng()) * spread;
  out.copy(direction)
    .addScaledVector(coneA, Math.cos(angle) * radius)
    .addScaledVector(coneB, Math.sin(angle) * radius)
    .normalize();
  return out;
}

export function aimDirection(from, to, out) {
  out.set(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = out.length();
  if (length < 0.0001) out.set(0, 0, -1);
  else out.multiplyScalar(1 / length);
  return out;
}

export function barTile(map, from, to) {
  return map.lineOfSight(from.x, from.z, to.x, to.z);
}

export { rayOrigin, rayDir, point };
