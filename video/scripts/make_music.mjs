// Writes the soundtrack (public/audio/soundtrack.wav): an original 150 BPM phonk/trap beat with
// impact hits, whooshes, risers, the scale's ticks and the phone's notification pings, all
// synthesized here from oscillators and seeded noise. No samples and no third-party audio, so
// the track is covered by the repository's MIT license, and the same file comes out every time.
//
//     node scripts/make_music.mjs
//
// The arrangement and the sound effects follow src/timeline.json, the same beat grid the video
// cuts on (150 BPM at 30 fps: one beat is exactly 12 frames).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const T = JSON.parse(readFileSync(new URL("../src/timeline.json", import.meta.url), "utf8"));
const OUT = new URL("../public/audio/soundtrack.wav", import.meta.url);
const SR = 48000;
const BEAT = 60 / T.bpm;
const STEP = BEAT / 4;   // a 16th note
const N = Math.ceil(T.durationInBeats * BEAT * SR);
const TAU = 2 * Math.PI;

// ---------- Helpers ----------
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(150);
const noise = () => rand() * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const len = (sec) => Math.max(1, Math.round(sec * SR));

class Biquad {   // RBJ cookbook filters
  constructor(type, freq, q = 0.707) { this.type = type; this.q = q; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(freq); }
  set(freq) {
    const w = TAU * Math.min(Math.max(freq, 10), SR * 0.45) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * this.q);
    let b0, b1, b2;
    if (this.type === "lp") [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (this.type === "hp") [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else [b0, b1, b2] = [a, 0, -a];   // band-pass, 0 dB peak
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ---------- Buses ----------
const bus = () => [new Float32Array(N), new Float32Array(N)];
const dry = bus();      // drums and effects
const ducked = bus();   // bass, pad and cowbell: pumped by the kick (sidechain)
const send = bus();     // reverb send
const kicks = [];       // kick times, for the sidechain

function place(sig, time, { gain = 1, pan = 0, rev = 0, duck = false } = {}) {
  const start = Math.round(time * SR), target = duck ? ducked : dry;
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = gain * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  for (let i = 0; i < sig.length; i++) {
    const j = start + i;
    if (j < 0) continue;
    if (j >= N) break;
    target[0][j] += sig[i] * gl; target[1][j] += sig[i] * gr;
    if (rev) { send[0][j] += sig[i] * gl * rev; send[1][j] += sig[i] * gr * rev; }
  }
}

// ---------- Instruments ----------
function kick() {
  const out = new Float32Array(len(0.55)), hp = new Biquad("hp", 1500);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += TAU * (46 + 150 * Math.exp(-t / 0.028)) / SR;
    const body = Math.sin(ph) * Math.exp(-t / 0.3);
    out[i] = Math.tanh(2.2 * body) * 0.8 + hp.run(noise()) * Math.exp(-t / 0.004) * 0.35;
  }
  return out;
}

function bass808(midi, dur, fromMidi = null) {
  const out = new Float32Array(len(dur + 0.05)), lp = new Biquad("lp", 900), lp2 = new Biquad("lp", 900);
  const f1 = hz(midi), f0 = fromMidi == null ? null : hz(fromMidi);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f0 == null ? f1 * (1 + 0.3 * Math.exp(-t / 0.018)) : f1 + (f0 - f1) * Math.exp(-t / 0.07);
    ph += TAU * f / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 1.4) * Math.min(1, Math.max(0, (dur + 0.05 - t) / 0.05));
    out[i] = lp2.run(lp.run(Math.tanh(1.8 * Math.sin(ph)) * env)) * 0.9;
  }
  return out;
}

function clap() {
  const out = new Float32Array(len(0.45)), bp = new Biquad("bp", 1400, 0.7), hp = new Biquad("hp", 1800);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let env = Math.exp(-Math.max(0, t - 0.024) / 0.11) * (t >= 0.024 ? 1 : 0);
    for (const o of [0, 0.009, 0.018]) if (t >= o && t < o + 0.012) env = Math.max(env, Math.exp(-(t - o) / 0.005));
    ph += TAU * 190 / SR;
    out[i] = bp.run(noise()) * env * 1.6 + hp.run(noise()) * Math.exp(-t / 0.12) * 0.35 + Math.sin(ph) * Math.exp(-t / 0.05) * 0.45;
  }
  return out;
}

function hat(open = false) {
  const out = new Float32Array(len(open ? 0.35 : 0.08)), h1 = new Biquad("hp", 6500), h2 = new Biquad("hp", 6500), lp = new Biquad("lp", 11000);
  for (let i = 0; i < out.length; i++) out[i] = lp.run(h2.run(h1.run(noise()))) * Math.exp(-(i / SR) / (open ? 0.12 : 0.022));
  return out;
}

// The phonk cowbell: two detuned square waves (the 808 cowbell's 1 : 1.48 ratio), band-limited
// by summing odd harmonics, with a short metallic decay. `cutoff` darkens it (intro, AI part).
function cowbell(midi, cutoff = 9000) {
  const out = new Float32Array(len(0.42)), hp = new Biquad("hp", hz(midi) * 0.8), lp = new Biquad("lp", cutoff);
  const fs = [hz(midi), hz(midi) * 1.4815];
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let s = 0;
    for (const f of fs) for (let k = 1; k * f < 14000; k += 2) s += Math.sin(TAU * f * k * t) / k;
    const env = Math.min(1, t / 0.0015) * (0.75 * Math.exp(-t / 0.07) + 0.25 * Math.exp(-t / 0.3));
    out[i] = lp.run(hp.run(Math.tanh(1.5 * s * 0.5) * env));
  }
  return out;
}

function pad(midis, dur, cutoff = 1800) {
  const out = new Float32Array(len(dur + 0.6)), lp = new Biquad("lp", cutoff, 0.9);
  const voices = midis.flatMap((m) => [-9, 0, 9].map((c) => ({ f: hz(m) * 2 ** (c / 1200), ph: rand() })));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let s = 0;
    for (const v of voices) { v.ph = (v.ph + v.f / SR) % 1; s += 2 * v.ph - 1; }
    const env = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (dur + 0.6 - t) / 0.6));
    out[i] = lp.run(s / voices.length) * env;
  }
  return out;
}

function riser(dur) {
  const out = new Float32Array(len(dur)), bp = new Biquad("bp", 400, 2.5), hp = new Biquad("hp", 2500);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const k = i / out.length;
    if (i % 32 === 0) bp.set(400 * 20 ** k);
    ph += TAU * (220 * 6 ** k) / SR;
    out[i] = bp.run(noise()) * k * k * 1.4 + Math.sin(ph) * k ** 3 * 0.12 + hp.run(noise()) * k ** 4 * 0.35;
  }
  return out;
}

function impact() {
  const out = new Float32Array(len(2.6)), lp = new Biquad("lp", 2500), hp = new Biquad("hp", 4500);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += TAU * (30 + 55 * Math.exp(-t / 0.35)) / SR;
    const sub = Math.sin(ph) * Math.exp(-t / 0.7);
    out[i] = Math.tanh(1.6 * sub) + lp.run(noise()) * Math.exp(-t / 0.18) * 0.7 + hp.run(noise()) * Math.exp(-t / 1.0) * 0.22;
  }
  return out;
}

function thud() {
  const out = new Float32Array(len(0.35)), lp = new Biquad("lp", 500);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += TAU * (42 + 60 * Math.exp(-t / 0.04)) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.12) + lp.run(noise()) * Math.exp(-t / 0.03) * 0.6;
  }
  return out;
}

function whoosh(dur = 0.5) {
  const out = new Float32Array(len(dur)), bp = new Biquad("bp", 500, 1.2);
  for (let i = 0; i < out.length; i++) {
    const k = i / out.length;
    if (i % 32 === 0) bp.set(400 + 5000 * Math.sin(Math.PI * k) ** 2);
    out[i] = bp.run(noise()) * Math.sin(Math.PI * k ** 0.7) ** 2 * 1.5;
  }
  return out;
}

function bell(freq, dur = 0.6) {   // a soft sine bell: ticks, the lock "ding" and the phone ping
  const out = new Float32Array(len(dur));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = (Math.sin(TAU * freq * t) * Math.exp(-t / (dur / 4)) + Math.sin(TAU * freq * 2.76 * t) * Math.exp(-t / (dur / 14)) * 0.3)
      * Math.min(1, t / 0.002);
  }
  return out;
}

function key() {   // a keyboard click, for the AI text being typed
  const out = new Float32Array(len(0.03)), bp = new Biquad("bp", 2500 + rand() * 2500, 1.5);
  for (let i = 0; i < out.length; i++) out[i] = bp.run(noise()) * Math.exp(-(i / SR) / 0.005);
  return out;
}

// ---------- Arrangement ----------
const at = (beat) => beat * BEAT;
// E phrygian. The cowbell plays a two-bar phrase (16ths, semitones over E5; null is a rest).
const BELL = [
  [0, null, 0, 3, null, 0, 7, null, 0, null, 3, 7, 8, null, 7, 3],
  [0, null, 0, 3, null, 0, 7, null, 12, null, 10, 8, 7, null, 3, 0],
];
const CHORDS = [[52, 55, 59], [48, 52, 55]];   // Em, C
const KICK = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
];
const BASS = [[[0, 28, 1.0], [10, 28, 0.6]], [[0, 36, 1.0], [7, 36, 0.4], [10, 38, 0.6, 36]]];   // [step, midi, beats, glide from]

function section(bar) {
  if (bar < 2) return "intro";
  if (bar < 12) return "main";
  if (bar < 16) return "ai";
  if (bar < 20) return "main2";
  if (bar < 22) return "free";
  if (bar < 23) return "main2";
  return "end";
}

const gap = (beat) => [[7.5, 8], [47.75, 48], [63.5, 64], [87.75, 88]].some(([a, b]) => beat >= a && beat < b);

function drums(bar, half) {
  const b0 = bar * 4, phrase = bar % 2;
  for (let s = 0; s < 16; s++) {
    const beat = b0 + s / 4;
    if (gap(beat)) continue;
    const t = at(beat);
    const k = half ? s === 0 || (phrase && s === 10) : KICK[phrase][s];
    if (k) { place(kick(), t, { gain: 0.95 }); kicks.push(t); }
    if (half ? s === 8 : s === 4 || s === 12) place(clap(), t, { gain: 0.72, rev: 0.25 });
    const hatOn = half ? true : s % 2 === 0 || (phrase && s >= 13);
    if (hatOn) place(hat(), t, { gain: (s % 4 === 0 ? 0.25 : 0.17) * (half ? 0.7 : 1), pan: s % 4 === 2 ? 0.25 : -0.15 });
    if (!half && phrase === 0 && s === 14) place(hat(true), t, { gain: 0.16, pan: 0.3 });
  }
  if (phrase === 1) for (let r = 0; r < 6; r++) {   // a triplet hat roll into the next phrase
    const beat = b0 + 3 + r / 6;
    if (!gap(beat)) place(hat(), at(beat), { gain: 0.1 + r * 0.025, pan: -0.3 + r * 0.12 });
  }
}

function bass(bar, long = false) {
  for (const [s, midi, beats, from] of BASS[bar % 2]) {
    const beat = bar * 4 + s / 4;
    if (gap(beat) || (long && s > 0)) continue;
    place(bass808(midi, (long ? 3.6 : beats) * BEAT, from ?? null), at(beat), { gain: 0.5, duck: true });
  }
}

function bells(bar, { cutoff = 9000, gain = 0.16, octave = false, rev = 0.2 } = {}) {
  BELL[bar % 2].forEach((n, s) => {
    const beat = bar * 4 + s / 4;
    if (n == null || gap(beat)) return;
    const c = typeof cutoff === "function" ? cutoff(beat) : cutoff;
    place(cowbell(76 + n, c), at(beat), { gain, pan: s % 2 ? 0.2 : -0.2, rev, duck: true });
    place(cowbell(76 + n, c), at(beat + 0.75), { gain: gain * 0.3, pan: s % 2 ? -0.5 : 0.5, rev, duck: true });   // dotted-8th echo
    if (octave) place(cowbell(88 + n, c), at(beat), { gain: gain * 0.35, pan: 0.4, rev, duck: true });
  });
}

const pads = (bar, gain = 0.12, cutoff = 1600) =>
  place(pad(CHORDS[bar % 2], 4 * BEAT - (gap(bar * 4 + 3.9) ? 0.5 * BEAT : 0), cutoff), at(bar * 4), { gain, rev: 0.4, duck: true });

function roll(from, to) {   // a snare roll that speeds up into a drop
  for (let beat = from; beat < to - 0.01;) {
    const k = (beat - from) / (to - from);
    place(clap(), at(beat), { gain: 0.15 + 0.3 * k, rev: 0.2, pan: (rand() - 0.5) * 0.4 });
    beat += k < 0.5 ? 0.25 : 0.125;
  }
}

const bars = Math.ceil(T.durationInBeats / 4);
for (let bar = 0; bar < bars; bar++) {
  const s = section(bar);
  if (s === "intro") {
    pads(bar, 0.22, 900 + bar * 900);
    bells(bar, { cutoff: (beat) => 900 * 9 ** (beat / 8), gain: 0.28, rev: 0.35 });
    place(bass808(28, 3.5 * BEAT), at(bar * 4), { gain: 0.35, duck: true });
    if (bar === 1) for (let st = 0; st < 16; st += 2) if (!gap(4 + st / 4)) place(hat(), at(4 + st / 4), { gain: 0.15 });
  } else if (s === "main" || s === "main2") {
    drums(bar, false);
    bass(bar);
    bells(bar, { octave: s === "main2" });
    if (s === "main2") pads(bar, 0.06, 2200);
  } else if (s === "ai") {
    drums(bar, true);
    bass(bar, true);
    bells(bar, { cutoff: 2600, gain: 0.16, rev: 0.45 });
    pads(bar, 0.16, 1400);
  } else if (s === "free") {
    const beat = bar * 4;
    place(kick(), at(beat), { gain: 1 }); kicks.push(at(beat));
    place(clap(), at(beat), { gain: 0.5, rev: 0.4 });
    place(bass808(28, 3.5 * BEAT), at(beat), { gain: 0.7, duck: true });
    place(pad([52, 55, 59, 64], 1.5 * BEAT, 4000), at(beat), { gain: 0.16, rev: 0.6 });
    for (let st = 0; st < 16; st++) if (!gap(beat + st / 4)) place(hat(), at(beat + st / 4), { gain: 0.06 + st * 0.008 });
  }
}

// Drum builds and the final hit.
roll(46, 47.75);
roll(62, 63.5);
roll(86, 87.75);
place(kick(), at(92), { gain: 1 }); kicks.push(at(92));
place(clap(), at(92), { gain: 0.5, rev: 0.6 });
place(bass808(28, 8 * BEAT), at(92), { gain: 0.75, duck: true });
place(pad([52, 55, 59, 64, 71], 6 * BEAT, 3000), at(92), { gain: 0.14, rev: 0.7 });
place(cowbell(76), at(92), { gain: 0.25, rev: 0.8 });

// ---------- Sound effects on the video's cues ----------
const C = T.cues;
for (const b of C.impact) place(impact(), at(b), { gain: b === 92 ? 1.15 : b === 80 || b === 8 ? 0.95 : 0.6, rev: 0.35 });
for (const b of C.thud) place(thud(), at(b), { gain: 0.6 });
for (const b of C.lock) { place(bell(1318.5, 0.9), at(b), { gain: 0.22, rev: 0.4 }); place(bell(1975.5, 0.9), at(b + 0.25), { gain: 0.18, rev: 0.4 }); }
for (let beat = C.ticks[0]; beat < C.ticks[1]; beat += 0.25) {   // the scale's digits counting
  const k = (beat - C.ticks[0]) / (C.ticks[1] - C.ticks[0]);
  place(bell(1800 + 900 * k, 0.06), at(beat), { gain: 0.1, pan: (rand() - 0.5) * 0.3 });
}
for (const b of C.ping) { place(bell(1318.5, 0.7), at(b), { gain: 0.25, rev: 0.3 }); place(bell(1760, 0.8), at(b + 0.3), { gain: 0.22, rev: 0.3 }); }
for (let beat = C.typing[0]; beat < C.typing[1]; beat += 0.125) {
  if (rand() < 0.7) place(key(), at(beat + rand() * 0.06), { gain: 0.09 + rand() * 0.06, pan: (rand() - 0.5) * 0.6 });
}
for (const b of C.whoosh) place(whoosh(0.5), at(b) - 0.08, { gain: 0.35, pan: 0 });
for (const [a, b] of C.riser) {
  place(riser(at(b) - at(a)), at(a), { gain: 0.32, rev: 0.2 });
}

// ---------- Sidechain, reverb and master ----------
const pump = new Float32Array(N).fill(1);
for (const t of kicks) {
  const s = Math.round(t * SR);
  for (let i = 0; i < len(0.3) && s + i < N; i++) pump[s + i] = Math.min(pump[s + i], 1 - 0.55 * Math.exp(-(i / SR) / 0.09));
}

function freeverb(input, room = 0.86, damp = 0.35, spread = 0) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * SR / 44100)), i: 0, f: 0 }));
  const alls = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * SR / 44100)), i: 0 }));
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const x = input[n] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.f = o * (1 - damp) + c.f * damp;
      c.buf[c.i] = x + c.f * room;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of alls) {
      const b = a.buf[a.i];
      a.buf[a.i] = y + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      y = b - y;
    }
    out[n] = y;
  }
  return out;
}
const wet = [freeverb(send[0]), freeverb(send[1], 0.86, 0.35, 23)];

const master = [new Float32Array(N), new Float32Array(N)];
for (let ch = 0; ch < 2; ch++) {
  const hp = new Biquad("hp", 28);
  for (let n = 0; n < N; n++) master[ch][n] = hp.run(dry[ch][n] + ducked[ch][n] * pump[n] + wet[ch][n] * 2.2);
}

// Loudness: drive into a soft clipper, then a sample peak of -3 dBFS, which keeps the true peak under -1 dBTP. Fade out the last 0.4 s.
const DRIVE = 1.0;
const soft = (x) => { const a = Math.abs(x); return a < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2)); };
let peak = 0;
for (const ch of master) for (let n = 0; n < N; n++) { ch[n] = soft(ch[n] * DRIVE); peak = Math.max(peak, Math.abs(ch[n])); }
const norm = 0.71 / peak, fade = len(0.4);
for (const ch of master) for (let n = 0; n < N; n++) ch[n] *= norm * Math.min(1, (N - n) / fade);

// ---------- WAV (16-bit PCM, stereo) ----------
const data = Buffer.alloc(N * 4);
for (let n = 0; n < N; n++) for (let ch = 0; ch < 2; ch++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, master[ch][n])) * 32767), n * 4 + ch * 2);
}
const head = Buffer.alloc(44);
head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
head.write("data", 36); head.writeUInt32LE(data.length, 40);
mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([head, data]));
console.log(`soundtrack: ${(N / SR).toFixed(2)} s, ${T.bpm} BPM -> ${OUT.pathname}`);
