// audio.js — every sound is synthesized with WebAudio. No audio files,
// no network, nothing for the gate to reject. Oscillators + filtered noise
// buffers generated once at boot. A garden sounds like a garden: birdsong
// chirps, water trickling from the fountain, a low breeze under everything.

import { WEAPONS } from './weapons.js';

export function createAudio(bus, getPlayerPos) {
  let ctx = null;
  let noiseBuf = null;
  let master = null;
  let ambientOn = false;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // 1 s of white noise, reused by every noise-based sound.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noiseBurst(dur, freq, gain, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type || 'lowpass';
    filt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  function tone(freq, dur, gain, type, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }

  // Gunshot: noise burst through a lowpass + a click transient. Distant
  // shots are lowpassed harder (distance in metres, 0 = at your ear).
  function shot(weapon, dist) {
    if (!ensure()) return;
    const d = Math.min(1, (dist || 0) / 40);
    const freq = weapon.pitch * 2.2 * (1 - d * 0.75);
    noiseBurst(weapon.length, freq, 0.5 * (1 - d * 0.6));
    tone(weapon.pitch, 0.05, 0.25 * (1 - d * 0.6), 'square', weapon.pitch * 0.5);
  }

  function reload() {
    if (!ensure()) return;
    noiseBurst(0.05, 3000, 0.2, 'bandpass');
    setTimeout(() => noiseBurst(0.05, 2400, 0.25, 'bandpass'), 180);
  }

  function step() {
    if (!ensure()) return;
    // Soft thud on gravel, timed to the stride by main.js.
    noiseBurst(0.06, 500, 0.10);
  }

  function hit() { tone(1800, 0.05, 0.15, 'sine'); }

  function kill() {
    tone(660, 0.09, 0.2, 'sine');
    setTimeout(() => tone(990, 0.12, 0.2, 'sine'), 90);
  }

  function beep(freq) { tone(freq, 0.12, 0.25, 'square'); }

  function roundSting(win) {
    if (!ensure()) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.22, 'triangle'), i * 140));
  }

  // Ambient: birdsong chirps on a slow random schedule + fountain trickle
  // (looped filtered noise, quiet) + a low breeze (slow LFO on a gain).
  function startAmbient() {
    if (!ensure() || ambientOn) return;
    ambientOn = true;
    // Fountain: steady trickle.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 1200; filt.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.015;
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start();
    // Breeze: very low noise, gain wobbling on a 7 s LFO.
    const bsrc = ctx.createBufferSource();
    bsrc.buffer = noiseBuf; bsrc.loop = true;
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass'; bf.frequency.value = 300;
    const bg = ctx.createGain(); bg.gain.value = 0.02;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1 / 7;
    const lg = ctx.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(bg.gain);
    bsrc.connect(bf); bf.connect(bg); bg.connect(master);
    bsrc.start(); lfo.start();
    // Birdsong: a chirp every 4–9 s (random, scheduled with the ctx clock).
    const chirp = () => {
      if (!ambientOn) return;
      const base = 2200 + Math.random() * 1800;
      tone(base, 0.08, 0.05, 'sine', base * 1.4);
      setTimeout(() => tone(base * 1.2, 0.06, 0.04, 'sine', base * 0.9), 120);
      setTimeout(chirp, 4000 + Math.random() * 5000);
    };
    setTimeout(chirp, 1500);
  }

  // Wire the event bus: shots and footsteps feed bot hearing AND audio
  // from the same event, so what you hear is what the bots hear.
  const api = {
    resume() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    startAmbient,
    shot, reload, step, hit, kill, beep, roundSting,
  };
  if (bus) {
    bus.on('shot', (e) => {
      const w = WEAPONS[e.weapon];
      if (!w) return;
      let d = 0;
      if (getPlayerPos) {
        const pp = getPlayerPos();
        d = Math.hypot(e.x - pp.x, e.z - pp.z);
      }
      api.shot(w, d);
    });
    bus.on('hit', (e) => { if (e.shooter && e.shooter.isPlayer) api.hit(); if (e.killed && e.shooter && e.shooter.isPlayer) api.kill(); });
  }
  return api;
}
