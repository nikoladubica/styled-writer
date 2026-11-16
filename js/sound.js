/* Styled Writer — typewriter sounds, synthesized with the Web Audio API.
   No audio files: every strike is generated, slightly different each time. */
window.Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.55;

    // a touch of compression keeps fast typing from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 1;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  // filtered noise burst — the "clack" of metal and paper
  function noise(t, dur, freq, q, gain, type = 'bandpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
    return f;
  }

  // a falling sine — the body "thump" of the type bar hitting the platen
  function thump(t, freq, dur, gain) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function tone(t, freq, dur, gain) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function ready() {
    return enabled && ctx && ctx.state === 'running';
  }

  // the escapement advancing one notch
  function escapement(t, gain = 0.12) {
    noise(t, 0.012, rand(4200, 5200), 6, gain);
  }

  return {
    init,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },

    key() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      const v = rand(0.85, 1.1);
      noise(t, 0.022, rand(2400, 3600), 0.9, 0.55 * v);            // slug hits paper
      noise(t + 0.002, 0.07, rand(800, 1100), 1.4, 0.22 * v);     // body resonance
      thump(t, rand(140, 180), 0.06, 0.45 * v);                   // platen thump
      escapement(t + rand(0.045, 0.06));                           // carriage notch
    },

    space() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      noise(t, 0.05, rand(500, 700), 0.7, 0.3, 'lowpass');
      thump(t, rand(85, 100), 0.08, 0.4);
      escapement(t + 0.03, 0.14);
    },

    backspace() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      noise(t, 0.03, rand(1500, 1900), 1.2, 0.25);
      thump(t, 110, 0.05, 0.22);
      escapement(t + 0.035, 0.1);
    },

    // carriage return: lever, ratchet clicks while sliding, then the clunk at the stop
    carriageReturn() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      noise(t, 0.05, 900, 1, 0.25);                               // lever grab
      const slide = noise(t + 0.03, 0.34, 1400, 0.8, 0.12);       // carriage slide
      slide.frequency.setValueAtTime(1400, t + 0.03);
      slide.frequency.exponentialRampToValueAtTime(500, t + 0.36);
      let at = t + 0.04;
      for (let i = 0; i < 12; i++) {                              // line-feed ratchet
        noise(at, 0.01, rand(3200, 4200), 4, 0.18);
        at += 0.018 + i * 0.0035;
      }
      const stop = t + 0.38;
      noise(stop, 0.09, 700, 1, 0.5);
      thump(stop, 75, 0.14, 0.6);
      noise(stop + 0.004, 0.03, 2600, 1.5, 0.25);
    },

    // the margin bell
    bell() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      const f = 2093;
      tone(t, f, 1.6, 0.16);
      tone(t, f * 2.76, 0.9, 0.05);
      tone(t, f * 5.4, 0.45, 0.025);
      noise(t, 0.015, 6000, 3, 0.08);
    },

    // feeding a fresh sheet: slow knob ratchet
    feed() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.001;
      let at = t;
      for (let i = 0; i < 18; i++) {
        noise(at, 0.014, rand(2600, 3400), 3, 0.16);
        at += 0.032 + Math.random() * 0.01;
      }
      noise(t, at - t, 300, 0.6, 0.05, 'lowpass');
    },
  };
})();
