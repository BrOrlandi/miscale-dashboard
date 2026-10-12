import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../lib";

/**
 * The green-and-white backdrop: a perspective grid floor that keeps scrolling toward the camera,
 * a couple of diagonal green bands and drifting particles. `tone` picks the white or the green
 * version (the green one matches the dashboard's weigh-in screen).
 */
export const Background: React.FC<{ tone?: "light" | "green"; speed?: number; bands?: boolean }> = ({ tone = "light", speed = 1, bands = true }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const green = tone === "green";
  const line = green ? "rgba(255,255,255,.16)" : "rgba(31,122,90,.22)";
  const size = 120;
  const scroll = (f * 6 * speed) % size;
  const base = green
    ? `radial-gradient(ellipse 80% 70% at 50% 35%, ${C.bright} 0%, ${C.deep} 70%, #083d2c 100%)`
    : `radial-gradient(ellipse 80% 70% at 50% 30%, #ffffff 0%, ${C.bg} 55%, #e4efe9 100%)`;
  const diag = Math.hypot(width, height);
  return (
    <AbsoluteFill style={{ background: base, overflow: "hidden" }}>
      {/* Floor grid */}
      <div style={{ position: "absolute", left: "50%", top: "52%", width: diag * 3, height: diag * 1.6, marginLeft: -diag * 1.5,
        transformOrigin: "50% 0%", transform: "perspective(900px) rotateX(74deg)",
        backgroundImage: `linear-gradient(${line} 2px, transparent 2px), linear-gradient(90deg, ${line} 2px, transparent 2px)`,
        backgroundSize: `${size}px ${size}px`, backgroundPosition: `0 ${scroll}px`,
        maskImage: "linear-gradient(to bottom, transparent 0%, black 25%, black 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 25%, black 100%)" }} />
      {/* Horizon glow */}
      <div style={{ position: "absolute", left: 0, right: 0, top: "40%", height: "24%",
        background: green ? "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(76,194,146,.45), transparent 70%)"
          : "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(255,255,255,.95), transparent 70%)" }} />
      {bands && <Bands green={green} f={f} w={width} h={height} />}
      <Particles green={green} f={f} w={width} h={height} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 75% 75% at 50% 50%, transparent 55%, rgba(8,40,28,.28) 100%)",
        opacity: green ? 1 : 0.35 }} />
    </AbsoluteFill>
  );
};

const Bands: React.FC<{ green: boolean; f: number; w: number; h: number }> = ({ green, f, w, h }) => {
  const color = green ? "rgba(255,255,255,.07)" : "rgba(31,138,99,.10)";
  const strong = green ? "rgba(255,255,255,.12)" : "rgba(31,138,99,.16)";
  const drift = (f * 2.2) % (w * 2);
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ position: "absolute", top: -h, height: h * 3, width: [w * 0.12, w * 0.05, w * 0.22][i],
          left: ((i * w * 0.7 + drift * (i % 2 ? -1 : 1)) % (w * 1.6)) - w * 0.3, background: i === 1 ? strong : color,
          transform: "rotate(24deg)" }} />
      ))}
    </>
  );
};

const Particles: React.FC<{ green: boolean; f: number; w: number; h: number }> = ({ green, f, w, h }) => {
  const dots = Array.from({ length: 26 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 127.1 + n * 311.7) * 43758.5453) % 1 + 1) % 1;
    const z = 0.3 + r(1) * 0.7;
    const y = ((r(2) * h - f * 1.6 * z) % h + h) % h;
    return { x: r(3) * w, y, z, s: 4 + r(4) * 10 };
  });
  return (
    <>
      {dots.map((d, i) => (
        <div key={i} style={{ position: "absolute", left: d.x, top: d.y, width: d.s * d.z, height: d.s * d.z, borderRadius: "50%",
          background: green ? "rgba(255,255,255,.5)" : C.bright, opacity: interpolate(d.z, [0.3, 1], [0.15, 0.45]),
          filter: `blur(${(1 - d.z) * 3}px)` }} />
      ))}
    </>
  );
};
