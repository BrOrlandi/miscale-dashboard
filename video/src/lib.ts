import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { Easing, interpolate, useVideoConfig } from "remotion";
import timeline from "./timeline.json";

export const T = timeline;
export const FPS = T.fps;
export const BEAT = T.framesPerBeat;              // 150 BPM at 30 fps: a beat is 12 frames
export const DURATION = T.durationInBeats * BEAT;
export const beat = (b: number) => Math.round(b * BEAT);
export const scene = (id: string) => {
  const s = T.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id}`);
  return { from: beat(s.beat), frames: beat(s.beats) };
};

// The dashboard's colors (app/static/index.html).
export const C = {
  green: "#1f7a5a",
  deep: "#0f5c43",
  bright: "#1f8a63",
  mint: "#4cc292",
  soft: "#e2f1ea",
  bg: "#f5f5f2",
  ink: "#1c1d1f",
  muted: "#6b6f76",
  warn: "#b4690e",
  white: "#ffffff",
};

export const DISPLAY = loadAnton("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
export const SANS = loadInter("normal", { weights: ["400", "500", "600", "700", "800", "900"], subsets: ["latin", "latin-ext"] }).fontFamily;

export const REPO = "github.com/BrOrlandi/miscale-dashboard";
export const DEMO = "brorlandi.github.io/miscale-dashboard";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const outCubic = Easing.bezier(0.22, 1, 0.36, 1);
export const outBack = Easing.bezier(0.34, 1.56, 0.64, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 to 1 between frames a and b, eased. */
export const ramp = (f: number, a: number, b: number, ease = outCubic) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: ease });

export const useVertical = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};

/** A short decaying kick after each of the given frames: camera shake and flashes. */
export const pulse = (f: number, at: number[], decay = 4) => {
  let v = 0;
  for (const a of at) if (f >= a) v = Math.max(v, Math.exp(-(f - a) / decay));
  return v;
};

// ---------- Alex's 90 days, generated like demo/demo.js does (same seed, same order) ----------
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd: () => number, sigma: number) => sigma * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

export type Point = { day: number; weight: number };
export const ALEX: Point[] = (() => {
  const rnd = mulberry32(7), out: Point[] = [];
  const [w0, w1, days] = [86.4, 81.6, 90];
  for (let d = days; d > 0; d--) {
    if (rnd() < 0.18) continue;
    rnd();   // the minute of the weigh-in
    const k = 1 - d / days;
    out.push({ day: days - d, weight: Math.round((w0 + (w1 - w0) * k + gauss(rnd, 0.35)) * 100) / 100 });
    gauss(rnd, 12);   // the impedance
  }
  out.push({ day: 90, weight: 81.35 });   // today's weigh-in, as in the recorded demo
  return out;
})();

export const movingAvg = (pts: Point[], days = 7) =>
  pts.map((p) => {
    const win = pts.filter((q) => q.day > p.day - days && q.day <= p.day);
    return { day: p.day, weight: win.reduce((a, q) => a + q.weight, 0) / win.length };
  });

export const fmt = (v: number, d = 1) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
