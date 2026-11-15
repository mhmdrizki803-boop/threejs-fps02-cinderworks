export function createInput(canvas, onLockChange) {
const keys = new Set();
const pressed = new Set();
const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0, pressedThisFrame: false };
function clearInput() {
keys.clear();
pressed.clear();
state.firing = false;
state.lookX = 0;
state.lookY = 0;
}
window.addEventListener('keydown', (event) => {
if (event.code === 'Tab' || event.code === 'Space') event.preventDefault();
if (!event.repeat) pressed.add(event.code);
keys.add(event.code);
});
window.addEventListener('keyup', (event) => {
keys.delete(event.code);
});
window.addEventListener('blur', clearInput);
window.addEventListener('mousemove', (event) => {
if (!state.locked) return;
state.lookX += event.movementX;
state.lookY += event.movementY;
});
window.addEventListener('mousedown', (event) => {
if (event.button !== 0) return;
pressed.add('Mouse0');
state.firing = true;
});
window.addEventListener('mouseup', (event) => {
if (event.button === 0) state.firing = false;
});
document.addEventListener('pointerlockchange', () => {
state.locked = document.pointerLockElement === canvas;
if (!state.locked) {
clearInput();
}
onLockChange(state.locked);
});
return {
state,
requestLock() {
if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
},
exitLock() {
if (document.pointerLockElement === canvas) document.exitPointerLock();
},
takeLook() {
const x = state.lookX;
const y = state.lookY;
state.lookX = 0;
state.lookY = 0;
return { x, y };
},
consume(code) {
if (!pressed.has(code)) return false;
pressed.delete(code);
return true;
},
clearPressed() {
pressed.clear();
},
};
}
