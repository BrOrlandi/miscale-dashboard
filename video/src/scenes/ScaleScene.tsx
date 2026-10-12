import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import { useLayoutEffect, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { Counter, Punch, Tag } from "../components/Text";
import { BEAT, C, clamp, DISPLAY, inOut, pulse, SANS, useVertical } from "../lib";
import { HIP_W, legIK, Mannequin, type Pose, SOLE } from "../three/Mannequin";
import { DISPLAY_Z, ScaleModel, SCALE_TOP } from "../three/ScaleModel";

// Beats 0-24: the person walks in (intro titles), steps on the scale on the drop (beat 8), the
// display counts up and locks the weight (beat 17), then the camera pulls out while the body
// composition pops up around the scale.

const STRIDE = 0.33, X0 = 2.76, ON_SCALE = 0.06;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);
const seg = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

/** Where a foot is at beat t: [x (world), sole height]. Right steps on even beats, left on odd. */
function foot(side: 0 | 1, t: number): [number, number] {
  const plants = side === 0
    ? [[X0, 0, -1], [X0 - 2 * STRIDE, 0, 0], [X0 - 4 * STRIDE, 0, 2], [X0 - 6 * STRIDE, 0, 4], [ON_SCALE, SCALE_TOP, 6.6]]
    : [[X0 - STRIDE, 0, -1], [X0 - 3 * STRIDE, 0, 1], [X0 - 5 * STRIDE, 0, 3], [X0 - 7 * STRIDE, 0, 5], [ON_SCALE, SCALE_TOP, 8.7]];
  for (let i = 1; i < plants.length; i++) {
    const [x0, y0] = plants[i - 1], [x1, y1, start] = plants[i];
    const end = i === plants.length - 1 ? (side === 0 ? 8 : 10) : start + 1;
    if (t < start) return [x0, y0];
    if (t < end) {
      const k = (t - start) / (end - start), e = smooth(k);
      const lift = i === plants.length - 1 ? 0.2 : 0.07;
      return [lerp(x0, x1, e), lerp(y0, y1, e) + lift * Math.sin(Math.PI * k ** 0.8)];
    }
  }
  const last = plants[plants.length - 1];
  return [last[0], last[1]];
}

function pose(t: number): Pose {
  const walk = seg(t, 0, 6);
  let x = X0 - STRIDE / 2 - STRIDE * Math.min(t, 6);
  let y = 0.875 + 0.022 * Math.sin(Math.PI * Math.min(t, 6)) ** 2;
  // Stepping up: the hips follow the right foot onto the scale, then settle over both feet.
  x = lerp(x, 0.36, smooth(seg(t, 6.2, 8)));
  x = lerp(x, ON_SCALE + 0.02, smooth(seg(t, 8, 10.2)));
  y = lerp(y, 0.87 + SCALE_TOP, smooth(seg(t, 8, 10.2)));
  y += 0.012 * Math.sin(t * 0.9) * seg(t, 11, 12);   // breathing
  const legs = ([0, 1] as const).map((side) => {
    const [fx, fy] = foot(side, t);
    return legIK(x - fx, y - (fy + SOLE));
  });
  const swing = 0.32 * Math.sin(Math.PI * t) * (1 - seg(t, 5.5, 6.5));
  const lean = 0.05 * (1 - walk * 0) + 0.12 * Math.sin(Math.PI * seg(t, 6.4, 10)) - 0.05 * seg(t, 10, 11);
  return { root: [x, y, 0], facing: -Math.PI / 2, lean, head: 0.32 * smooth(seg(t, 10.5, 12)), legs, arms: [swing, -swing] };
}

type Cam = { p: [number, number, number]; l: [number, number, number] };
const KEYS: [number, Cam][] = [
  [0, { p: [3.4, 1.35, 3.7], l: [2.0, 0.8, 0] }],
  [5.99, { p: [1.7, 1.05, 3.0], l: [0.7, 0.7, 0] }],
  [6, { p: [0.95, 0.3, 1.2], l: [0.25, 0.16, 0] }],     // cut: low angle on the feet
  [10.5, { p: [0.7, 0.27, 1.05], l: [0.1, 0.12, 0] }],
  [12.5, { p: [0.06, 0.66, 0.66], l: [0, 0.12, DISPLAY_Z - 0.06] }],
  [17, { p: [0.03, 0.48, 0.5], l: [0, 0.1, DISPLAY_Z - 0.05] }],
  [18, { p: [0.4, 0.75, 1.4], l: [0, 0.55, 0] }],
  [24, { p: [-1.5, 1.25, 2.6], l: [0, 0.75, 0] }],
];

function camera(t: number): Cam {
  for (let i = 1; i < KEYS.length; i++) {
    const [t0, a] = KEYS[i - 1], [t1, b] = KEYS[i];
    if (t <= t1) {
      const k = inOut(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
      return { p: a.p.map((v, j) => lerp(v, b.p[j], k)) as Cam["p"], l: a.l.map((v, j) => lerp(v, b.l[j], k)) as Cam["l"] };
    }
  }
  return KEYS[KEYS.length - 1][1];
}

const Rig: React.FC<{ t: number; shake: number; fov: number }> = ({ t, shake, fov }) => {
  const cam = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    const { p, l } = camera(t);
    const j = shake * 0.012;
    cam.position.set(p[0] + Math.sin(t * 47) * j, p[1] + Math.cos(t * 61) * j, p[2]);
    cam.fov = fov;
    cam.near = 0.01;
    cam.updateProjectionMatrix();
    cam.lookAt(l[0], l[1], l[2]);
  }, [cam, t, shake, fov]);
  return null;
};

/** What the display shows: off, 0.0 after the first foot, then settling readings like the app's live screen. */
function reading(t: number) {
  if (t < 8) return "";
  const seq: [number, string][] = [[8, "0.0"], [12, "24.4"], [12.75, "58.3"], [13.5, "77.2"], [14.25, "80.9"], [15, "81.7"], [15.75, "81.2"], [16.5, "81.4"]];
  let out = "";
  for (const [b, v] of seq) if (t >= b) out = v;
  if (t >= 12 && t < 16.5) {   // flicker between readings, like a live sensor
    const k = (t - 12) * 4;
    const base = parseFloat(out);
    out = (base + (Math.sin(k * 7.3) * 0.6 * (1 - (t - 12) / 4.5))).toFixed(1);
  }
  return out;
}

function shadowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(10,40,28,0.55)"); g.addColorStop(1, "rgba(10,40,28,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const World: React.FC<{ t: number; shake: number; fov: number; ring: number; lineScale: number }> = ({ t, shake, fov, ring, lineScale }) => {
  const p = pose(t);
  const shadow = useMemo(shadowTexture, []);
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(30, 120, C.bright, C.bright);
    (g.material as THREE.Material).transparent = true;
    (g.material as THREE.Material).opacity = 0.28;
    return g;
  }, []);
  const lit = t >= 16.5 ? 1 - Math.min(1, (t - 16.5) / 2) * 0.5 : 0;
  return (
    <>
      <color attach="background" args={["#eef3f0"]} />
      <fog attach="fog" args={["#eef3f0", 3, 11]} />
      <hemisphereLight args={["#ffffff", "#cfe3d9", 1.3]} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#bfe8d6" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#f4f7f5" roughness={0.9} />
      </mesh>
      <primitive object={grid} position={[0, 0.0005, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0008, 0]}>
        <planeGeometry args={[0.62, 0.62]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
      {([0, 1] as const).map((side) => {
        const [fx, fy] = foot(side, t);
        return (
          <mesh key={side} rotation={[-Math.PI / 2, 0, 0]} position={[fx - 0.06, (fy > 0.02 ? SCALE_TOP : 0) + 0.0012, (side ? 1 : -1) * HIP_W]}>
            <planeGeometry args={[0.36, 0.16]} />
            <meshBasicMaterial map={shadow} transparent opacity={Math.max(0, 0.7 - (fy % SCALE_TOP > 0.002 ? fy * 4 : 0))} depthWrite={false} />
          </mesh>
        );
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.root[0], 0.0006, 0]}>
        <planeGeometry args={[1.0, 0.7]} />
        <meshBasicMaterial map={shadow} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <ScaleModel text={reading(t)} glow={lit} ring={ring} />
      <Mannequin pose={p} color={C.bright} scale={lineScale} />
      <Rig t={t} shake={shake} fov={fov} />
    </>
  );
};

export const ScaleScene: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = useVertical();
  const t = f / BEAT;
  const shake = pulse(f, [8 * BEAT, 17 * BEAT], 5) + 0.5 * pulse(f, [10 * BEAT], 4);
  const ring = pulse(f, [8 * BEAT, 10 * BEAT, 17 * BEAT], 10);
  const flash = pulse(f, [8 * BEAT, 17 * BEAT], 3);
  const fov = vertical ? 62 : 34;
  const big = vertical ? 150 : 170;
  const top = vertical ? 300 : 110;
  return (
    <AbsoluteFill>
      <ThreeCanvas width={width} height={height} gl={{ stencil: true, antialias: true, preserveDrawingBuffer: true }} flat
        camera={{ fov, position: [3, 1.3, 3.6], near: 0.01, far: 100 }}>
        <World t={t} shake={shake} fov={fov} ring={ring} lineScale={height / 1080 * (vertical ? 0.75 : 1)} />
      </ThreeCanvas>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 60%, rgba(15,92,67,.22) 100%)" }} />
      <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.55 }} />
      {/* Intro titles, one per two beats. */}
      <div style={{ position: "absolute", left: vertical ? 0 : 110, right: vertical ? 0 : "45%", top: vertical ? top : 380 }}>
        <Punch text="Your scale." at={0} until={20} size={big} color={C.ink} style={{ textAlign: vertical ? "center" : "left" }} />
        <Punch text="Your data." at={24} until={44} size={big} color={C.ink} style={{ textAlign: vertical ? "center" : "left" }} />
        <Punch text="No cloud." at={48} until={70} size={big} color={C.green} accent={C.soft} style={{ textAlign: vertical ? "center" : "left" }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top }}>
        <Punch text="Step on." at={8 * BEAT} until={11 * BEAT} size={big * 1.15} color={C.deep} />
      </div>
      <Reading f={f} vertical={vertical} />
      <Composition f={f} vertical={vertical} />
    </AbsoluteFill>
  );
};

/** The locked weight, big, when the display settles (beat 17). */
const Reading: React.FC<{ f: number; vertical: boolean }> = ({ f, vertical }) => {
  const at = 17 * BEAT;
  if (f < 12 * BEAT || f >= 18 * BEAT + 6) return null;
  const locked = f >= at;
  const out = interpolate(f, [18 * BEAT, 18 * BEAT + 6], [0, 1], clamp);
  const pop = locked ? 1 + 0.18 * Math.exp(-(f - at) / 3) : 1;
  return (
    <div style={{ position: "absolute", left: vertical ? 0 : 110, right: vertical ? 0 : undefined, top: vertical ? 330 : 380,
      textAlign: vertical ? "center" : "left", transformOrigin: "0% 50%", opacity: 1 - out,
      transform: `scale(${pop * (1 - out * 0.3)})` }}>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: vertical ? 34 : 30, letterSpacing: "0.3em", color: C.green, textTransform: "uppercase" }}>
        {locked ? "Weight locked" : "Reading the scale…"}
      </div>
      <div style={{ fontFamily: DISPLAY, fontSize: vertical ? 220 : 200, lineHeight: 1, color: locked ? C.deep : C.ink,
        textShadow: locked ? `0 0 40px rgba(76,194,146,.6), 8px 8px 0 ${C.soft}` : "none" }}>
        {reading(f / BEAT) || "0.0"}
        <span style={{ fontSize: "0.4em", marginLeft: 12 }}>kg</span>
      </div>
    </div>
  );
};

/** Body composition chips around the scale while the camera pulls out (beats 18-24). */
const Composition: React.FC<{ f: number; vertical: boolean }> = ({ f, vertical }) => {
  if (f < 18 * BEAT) return null;
  const items: [string, number, number, string, number][] = [
    ["Body fat", 25.0, 1, "%", 18], ["Muscle", 57.9, 1, " kg", 19], ["Water", 51.4, 1, "%", 20],
    ["Visceral fat", 15.3, 1, "", 21], ["BMR", 1648, 0, " kcal", 22], ["BMI", 25.7, 1, "", 23],
  ];
  const spots = vertical
    ? [[60, 520], [580, 600], [60, 1240], [600, 1320], [90, 1520], [600, 1600]]
    : [[110, 300], [1390, 260], [90, 560], [1420, 520], [160, 800], [1380, 780]];
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, top: vertical ? 300 : 70 }}>
        <Punch text="Full body composition" at={18 * BEAT} size={vertical ? 92 : 110} color={C.deep} accent={C.soft} />
      </div>
      {items.map(([label, v, d, unit, b], i) => (
        <Tag key={label} at={b * BEAT} style={{ left: spots[i][0], top: spots[i][1], background: "rgba(255,255,255,.92)",
          boxShadow: "0 18px 50px rgba(15,92,67,.22)", letterSpacing: "0.04em", padding: "18px 30px", borderRadius: 26 }} size={vertical ? 28 : 26}>
          <div style={{ fontSize: "0.8em", color: C.muted, letterSpacing: "0.14em" }}>{label}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: "2.4em", color: C.ink, letterSpacing: 0, lineHeight: 1.1, textTransform: "none" }}>
            <Counter from={v * 0.6} to={v} start={b * BEAT} end={b * BEAT + 10} decimals={d} suffix={unit} />
          </div>
        </Tag>
      ))}
    </>
  );
};
