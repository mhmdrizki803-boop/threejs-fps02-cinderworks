// Player body: acceleration, crouch, jump and the shared collider sweep.
import * as THREE from 'three';
import { createMover } from './physics.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.76;
const CROUCH_HEIGHT = 1.14;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.0;
const RUN_SPEED = 5.15;
const WALK_SPEED = 2.7;
const CROUCH_SPEED = 2.25;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 8;
const FRICTION = 10;
const GRAVITY = 20;
const JUMP_SPEED = 6.1;

export function createPlayer(colliders) {
  const mover = createMover(colliders);
  const state = {
    position: new THREE.Vector3(0, 0, 18.5),
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    eye: STAND_EYE,
    health: 100,
    armor: 0,
    helmet: false,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    radius: RADIUS,
    alive: true,
    team: 'ember',
    name: 'YOU',
    kills: 0,
    deaths: 0,
    moved: 0,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function addRecoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys, enabled = true) {
    const wasX = state.position.x;
    const wasZ = state.position.z;
    const wasY = state.position.y;
    const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (enabled && crouchKey && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if ((!crouchKey || !enabled) && state.crouching && !mover.overlaps(state.position.x, state.position.y, state.position.z, RADIUS, STAND_HEIGHT, 0.02)) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 13);

    let forward = 0;
    let strafe = 0;
    if (enabled && state.alive) {
      forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    }
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const targetSpeed = state.crouching ? CROUCH_SPEED : walking ? WALK_SPEED : RUN_SPEED;
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / targetSpeed);
    state.velocity.x += (wish.x * targetSpeed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * targetSpeed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (enabled && state.alive && keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;

    const moved = mover.moveXZ(state.position.x, state.position.z, state.velocity.x * dt, state.velocity.z * dt, RADIUS, state.height);
    if (Math.abs(moved.x - state.position.x) < Math.abs(state.velocity.x * dt) - 0.001) state.velocity.x = 0;
    if (Math.abs(moved.z - state.position.z) < Math.abs(state.velocity.z * dt) - 0.001) state.velocity.z = 0;
    state.position.x = moved.x;
    state.position.z = moved.z;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = mover.overlaps(state.position.x, state.position.y, state.position.z, RADIUS, state.height, 0);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.position.x = Math.max(-21.4, Math.min(21.4, state.position.x));
    state.position.z = Math.max(-21.4, Math.min(21.4, state.position.z));
    state.velocity.y = Math.max(-30, state.velocity.y);
    const actual = Math.hypot(state.position.x - wasX, state.position.z - wasZ);
    state.moved += Math.abs(state.position.y - wasY) + actual;
    return actual;
  }

  function respawn(spawn, team) {
    state.position.set(spawn.x, 0, spawn.z);
    state.velocity.set(0, 0, 0);
    state.yaw = team === 'ember' ? Math.PI : 0;
    state.pitch = 0;
    state.eye = STAND_EYE;
    state.height = STAND_HEIGHT;
    state.crouching = false;
    state.health = 100;
    state.alive = true;
    state.onGround = true;
    state.team = team;
  }

  function damage(amount, part) {
    if (!state.alive) return { killed: false, health: 0 };
    let damage = amount;
    if (part === 'head' && state.helmet) damage *= 0.72;
    if (state.armor > 0) {
      const absorbed = damage * 0.5;
      state.armor = Math.max(0, state.armor - absorbed * 0.9);
      damage -= absorbed;
    }
    state.health = Math.max(0, state.health - damage);
    if (state.health === 0) {
      state.alive = false;
      state.deaths += 1;
      return { killed: true, health: 0 };
    }
    return { killed: false, health: state.health };
  }

  return { state, step, look, addRecoil, respawn, damage };
}
