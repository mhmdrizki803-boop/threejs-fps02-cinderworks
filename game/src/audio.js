// Procedural WebAudio: gunfire, footsteps, reloads, hits and the pulse core.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return context;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.5;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    master.connect(limiter).connect(context.destination);
    const length = context.sampleRate;
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  }

  function noise(duration, type, frequency, gain, pan = 0, q = 0.8) {
    const ctx = ensure();
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const amp = ctx.createGain();
    const now = ctx.currentTime;
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(filter).connect(amp).connect(panner).connect(master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  function tone(frequency, duration, type, gain, slideTo = null, pan = 0) {
    const ctx = ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(frequency, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(amp).connect(panner).connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  const GUN = {
    kestrel: { freq: 1500, gain: 0.32, thump: 150 },
    rattler: { freq: 1900, gain: 0.28, thump: 120 },
    longbow: { freq: 1300, gain: 0.42, thump: 96 },
    talon: { freq: 900, gain: 0.55, thump: 70 },
  };

  return {
    unlock() { ensure(); },
    shot(id, pan = 0) {
      const spec = GUN[id] ?? GUN.longbow;
      noise(0.14, 'bandpass', spec.freq, spec.gain, pan, 0.7);
      noise(0.05, 'highpass', 3800, spec.gain * 0.4, pan, 0.5);
      tone(spec.thump, 0.11, 'sine', spec.gain * 0.9, spec.thump * 0.55, pan);
    },
    step(pan = 0, loud = 1) {
      noise(0.07, 'lowpass', 700, 0.09 * loud, pan, 0.6);
    },
    reload(duration = 2) {
      const ctx = ensure();
      if (!ctx) return;
      tone(2400, 0.03, 'square', 0.05, 1600);
      setTimeout(() => tone(1800, 0.04, 'square', 0.06, 1200), duration * 380);
      setTimeout(() => tone(2100, 0.03, 'square', 0.05, 1400), duration * 820);
    },
    hit(headshot = false) {
      tone(headshot ? 1800 : 1200, 0.05, 'square', 0.1, headshot ? 2400 : 900);
    },
    flesh() {
      noise(0.09, 'lowpass', 420, 0.22, 0, 0.4);
    },
    beep(frequency = 880) {
      tone(frequency, 0.1, 'square', 0.08);
    },
    plant() {
      tone(520, 0.09, 'sawtooth', 0.09, 760);
      setTimeout(() => tone(680, 0.12, 'sawtooth', 0.09, 980), 110);
    },
    defuse() {
      tone(700, 0.06, 'triangle', 0.07);
    },
    explode() {
      noise(0.75, 'lowpass', 320, 0.75, 0, 0.3);
      noise(0.35, 'bandpass', 900, 0.5, 0, 0.5);
      tone(52, 0.7, 'sine', 0.65, 28);
    },
    roundStart() {
      tone(420, 0.14, 'triangle', 0.09);
      setTimeout(() => tone(630, 0.22, 'triangle', 0.09), 150);
    },
    buy() {
      tone(900, 0.05, 'square', 0.05, 1300);
    },
    deny() {
      tone(220, 0.11, 'square', 0.06, 150);
    },
    win() {
      tone(523, 0.16, 'triangle', 0.1);
      setTimeout(() => tone(659, 0.16, 'triangle', 0.1), 150);
      setTimeout(() => tone(784, 0.32, 'triangle', 0.1), 300);
    },
    lose() {
      tone(330, 0.2, 'sawtooth', 0.07, 220);
      setTimeout(() => tone(220, 0.4, 'sawtooth', 0.06, 160), 180);
    },
  };
}
