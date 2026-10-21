// 0.3.9: sound. Everything is synthesised in the browser (Web Audio), no file: an ambient generative music whose mood
// follows the game (calm, tension, crisis) and a few short signals (a new technology, a colony, a battle, an alert).
// It starts at the first click or key (the browsers' rule) and follows the preferences (prefs.ts).
import { uiPrefs, onPrefs } from './prefs';

export type Mood = 'calm' | 'tension' | 'crisis';
export type Sfx = 'turn' | 'tech' | 'colony' | 'battle' | 'alert' | 'victory' | 'defeat' | 'discovery';

let ctx: AudioContext | null = null;
let master: GainNode, musicBus: GainNode, sfxBus: GainNode, reverb: ConvolverNode, wet: GainNode;
let mood: Mood = 'calm';
let timer: number | undefined;
let nextChord = 0, chordIdx = 0, nextSparkle = 0, nextPulse = 0;
let drone: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** A soft stereo hall: exponentially decaying noise. */
function impulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function setup() {
  if (ctx) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4;
  master = ctx.createGain(); master.connect(comp); comp.connect(ctx.destination);
  musicBus = ctx.createGain(); sfxBus = ctx.createGain();
  reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, 3.2, 2.6);
  wet = ctx.createGain(); wet.gain.value = 0.55;
  musicBus.connect(master); sfxBus.connect(master);
  musicBus.connect(reverb); sfxBus.connect(reverb); reverb.connect(wet); wet.connect(master);
  volumes();
  nextChord = ctx.currentTime + 0.3; nextSparkle = ctx.currentTime + 4; nextPulse = ctx.currentTime + 2;
  timer = window.setInterval(schedule, 200);
  // 0.3.9.21: a mood set before the sound started (a game loaded in a crisis) gets its drone now
  if (mood !== 'calm') setDrone(true, mood === 'crisis' ? 26 : 38);
}

function volumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(uiPrefs.sound ? 1 : 0, t, 0.1);
  musicBus.gain.setTargetAtTime(uiPrefs.music * 0.32, t, 0.3);
  sfxBus.gain.setTargetAtTime(uiPrefs.sfx * 0.55, t, 0.05);
  if (!uiPrefs.sound && ctx.state === 'running') void ctx.suspend(); else if (uiPrefs.sound && ctx.state === 'suspended' && !document.hidden) void ctx.resume();
}

// ----- the music

/** Chords (MIDI notes) of each mood: D aeolian / dorian when calm, phrygian when tense, tritones in a crisis. */
const CHORDS: Record<Mood, number[][]> = {
  calm: [[50, 57, 62, 64, 69], [46, 53, 58, 62, 65], [41, 48, 57, 60, 64], [48, 55, 62, 64, 67]],
  tension: [[50, 57, 62, 65], [51, 58, 63, 67], [46, 53, 58, 61], [50, 56, 62, 65]],
  crisis: [[38, 50, 56, 62], [39, 51, 57, 63], [38, 50, 53, 59], [36, 48, 54, 60]],
};
const SCALE: Record<Mood, number[]> = { calm: [62, 64, 65, 69, 72, 74, 76, 81], tension: [62, 63, 65, 67, 70, 74, 75], crisis: [62, 63, 68, 69, 74, 75] };
const CHORD_LEN: Record<Mood, number> = { calm: 9, tension: 8, crisis: 6.5 };

function pad(note: number, t: number, len: number, level: number, bright: number) {
  const c = ctx!;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = bright; f.Q.value = 0.4;
  const g = c.createGain(); g.gain.value = 0;
  for (const det of [-6, 5]) {
    const o = c.createOscillator(); o.type = note < 48 ? 'sine' : 'triangle'; o.frequency.value = midi(note); o.detune.value = det;
    o.connect(f); o.start(t); o.stop(t + len + 4.5);
  }
  f.connect(g); g.connect(musicBus);
  const attack = Math.min(3, len / 3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setValueAtTime(level, t + len);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len + 4);
}

function sparkle(note: number, t: number, level: number) {
  const c = ctx!;
  const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = midi(note);
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = midi(note) * 2.01;
  const g = c.createGain(); g.gain.value = 0;
  const g2 = c.createGain(); g2.gain.value = 0.25;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(musicBus);
  // a soft echo
  const d = c.createDelay(1); d.delayTime.value = 0.42; const fb = c.createGain(); fb.gain.value = 0.35;
  g.connect(d); d.connect(fb); fb.connect(d); d.connect(musicBus);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  o.start(t); o2.start(t); o.stop(t + 2.5); o2.stop(t + 2.5);
}

/** A muffled heartbeat (tension, crisis): filtered noise. */
function pulse(t: number, level: number) {
  const c = ctx!;
  const n = c.createBufferSource(); const len = Math.floor(c.sampleRate * 0.25);
  const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  n.buffer = b;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
  const g = c.createGain(); g.gain.value = level;
  n.connect(f); f.connect(g); g.connect(musicBus);
  n.start(t);
}

function setDrone(on: boolean, note: number) {
  const c = ctx!;
  if (on && !drone) {
    const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = midi(note);
    const gain = c.createGain(); gain.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12; const lg = c.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(gain.gain); lfo.start();
    osc.connect(gain); gain.connect(musicBus); osc.start();
    gain.gain.setTargetAtTime(0.06, c.currentTime, 3);
    drone = { osc, gain, lfo };
  } else if (!on && drone) {
    const d = drone; drone = null;
    d.gain.gain.setTargetAtTime(0, c.currentTime, 2);
    d.osc.stop(c.currentTime + 8); d.lfo.stop(c.currentTime + 8); // (0.3.9.21: the LFO ran on for ever)
  } else if (on && drone) drone.osc.frequency.setTargetAtTime(midi(note), c.currentTime, 2);
}

let rnd = 12345;
const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };

function schedule() {
  if (!ctx || ctx.state !== 'running' || uiPrefs.music <= 0) return;
  const now = ctx.currentTime, ahead = now + 0.6;
  // 0.3.9.21: after a pause (music at 0, tab hidden), from now on, not every chord missed played at once
  if (nextChord < now) nextChord = now + 0.05;
  if (nextSparkle < now) nextSparkle = now + 1;
  if (nextPulse < now) nextPulse = now + 0.2;
  const chords = CHORDS[mood], len = CHORD_LEN[mood];
  while (nextChord < ahead) {
    const ch = chords[chordIdx % chords.length];
    const bright = mood === 'calm' ? 1100 + rand() * 500 : mood === 'tension' ? 800 : 650;
    ch.forEach((n, k) => pad(n, nextChord + k * 0.12, len, k === 0 ? 0.05 : 0.032, bright));
    chordIdx++;
    nextChord += len;
  }
  while (nextSparkle < ahead) {
    const sc = SCALE[mood];
    const n = sc[Math.floor(rand() * sc.length)] + (rand() < 0.3 ? 12 : 0);
    sparkle(n, nextSparkle, mood === 'calm' ? 0.05 : 0.035);
    nextSparkle += (mood === 'calm' ? 2.2 : 3.5) + rand() * (mood === 'calm' ? 3.5 : 5);
  }
  if (mood !== 'calm') {
    while (nextPulse < ahead) {
      const beat = mood === 'crisis' ? 0.8 : 1.25;
      pulse(nextPulse, mood === 'crisis' ? 0.5 : 0.32); pulse(nextPulse + 0.22, mood === 'crisis' ? 0.3 : 0.18);
      nextPulse += beat;
    }
  } else nextPulse = ahead;
}

export function setMood(m: Mood) {
  if (m === mood) return;
  mood = m;
  if (!ctx) return;
  setDrone(m !== 'calm', m === 'crisis' ? 26 : 38);
}

// ----- the signals

function tone(freq: number, t: number, len: number, type: OscillatorType, level: number, to?: number) {
  const c = ctx!;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 4000;
  o.connect(f); f.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + len + 0.05);
}

function noise(t: number, len: number, level: number, from: number, to: number, type: BiquadFilterType = 'bandpass') {
  const c = ctx!;
  const n = c.createBufferSource(); const sz = Math.floor(c.sampleRate * len);
  const b = c.createBuffer(1, sz, c.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
  n.buffer = b;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + len); f.Q.value = 1.2;
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + len * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(f); f.connect(g); g.connect(sfxBus); n.start(t);
}

export function play(s: Sfx, delay = 0) {
  if (!ctx || !uiPrefs.sound || uiPrefs.sfx <= 0 || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.02 + delay;
  switch (s) {
    case 'turn': noise(t, 0.7, 0.18, 300, 2400); break;
    case 'tech': [84, 88, 91, 96].forEach((n, k) => tone(midi(n), t + k * 0.09, 1.2, 'sine', 0.18)); break;
    case 'colony': tone(midi(67), t, 0.9, 'triangle', 0.22); tone(midi(74), t + 0.16, 1.3, 'triangle', 0.22); break;
    case 'discovery': [76, 83, 88].forEach((n, k) => tone(midi(n), t + k * 0.14, 1.6, 'sine', 0.14)); break;
    case 'battle': tone(90, t, 0.6, 'sine', 0.55, 38); noise(t, 0.5, 0.35, 1200, 200, 'lowpass'); tone(70, t + 0.28, 0.5, 'sine', 0.35, 32); break;
    case 'alert': tone(midi(81), t, 0.25, 'square', 0.07); tone(midi(76), t + 0.2, 0.35, 'square', 0.07); break;
    case 'victory': [60, 64, 67, 72, 76, 79, 84].forEach((n, k) => tone(midi(n), t + k * 0.11, 1.8, 'triangle', 0.18)); break;
    case 'defeat': [69, 65, 62, 57].forEach((n, k) => tone(midi(n), t + k * 0.32, 1.6, 'triangle', 0.16)); break;
  }
}

// ----- life cycle: started by the first gesture, paused in the background

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document && typeof window.addEventListener === 'function') {
  const start = () => { setup(); if (ctx && ctx.state === 'suspended' && uiPrefs.sound) void ctx.resume(); };
  window.addEventListener('pointerdown', start, { capture: true });
  window.addEventListener('keydown', start, { capture: true });
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) void ctx.suspend(); else if (uiPrefs.sound) void ctx.resume(); });
  onPrefs(volumes);
}

export const audioStarted = () => !!ctx;
export function stopAudio() { if (timer) clearInterval(timer); timer = undefined; }
