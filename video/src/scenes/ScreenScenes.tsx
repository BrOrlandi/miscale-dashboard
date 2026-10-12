import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { DrawnChart } from "../components/Chart";
import { type Pose, Screen } from "../components/Screen";
import { Counter, Punch, Tag } from "../components/Text";
import { C, clamp, DISPLAY, inOut, SANS, useVertical } from "../lib";

// The "projected screen" shots: the recorded live demo floating in 3D, plus the chart drawn as
// motion graphics. Clip times are frames of public/footage/*.mp4 (30 fps):
//   weighin.mp4  0.7 s weight settling, 4.2 s stable, 7.0 s body composition, 17.3 s the screen
//                closes and the dashboard updates, 21 s the weekly analysis starts typing
//   chart.mp4    0 / 2.2 / 4.4 s the chart drawn in for 30 days, 90 days and all time

/** Flies in from the side on the cut, then drifts slowly so the screen never sits still. */
function flyIn(f: number, fps: number, from: Pose, rest: Pose, drift: Pose, frames: number): Pose {
  const s = spring({ frame: f, fps, config: { damping: 18, stiffness: 120, mass: 0.8 } });
  const d = interpolate(f, [0, frames], [0, 1], { ...clamp, easing: inOut });
  const keys = ["x", "y", "z", "rx", "ry", "rz", "scale"] as const;
  const out: Pose = {};
  for (const k of keys) {
    const r = rest[k] ?? (k === "scale" ? 1 : 0);
    out[k] = (from[k] ?? r) + (r - (from[k] ?? r)) * s + (drift[k] ?? 0) * d;
  }
  return out;
}

export const LiveScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const pose = v
    ? flyIn(f, fps, { y: 900, rx: 40, z: -400 }, { y: 120, rx: 8, ry: -6 }, { ry: 10, z: 120 }, 96)
    : flyIn(f, fps, { x: 1500, ry: -60, z: -300 }, { x: 250, ry: -16, rx: 5 }, { ry: 8, z: 140 }, 96);
  const w = v ? 960 : 1250;
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={57}>
        <Screen clip="weighin.mp4" trimBefore={21} playbackRate={2} width={w} pose={pose} />
      </Sequence>
      <Sequence from={57}>
        <Screen clip="weighin.mp4" trimBefore={208} width={w} pose={pose} />
      </Sequence>
      <div style={{ position: "absolute", left: v ? 0 : 100, right: v ? 0 : "58%", top: v ? 230 : 300 }}>
        <Punch text={"Live on\nevery screen"} at={0} size={v ? 130 : 128} color={C.ink} style={{ textAlign: v ? "center" : "left" }} />
      </div>
      <Tag at={10} style={v ? { left: 160, top: 1560 } : { left: 104, top: 600 }} size={v ? 30 : 26}>The weight settles as you stand</Tag>
      <Tag at={57} style={v ? { left: 180, top: 1650 } : { left: 104, top: 690 }} size={v ? 30 : 26}>Then the body composition</Tag>
    </AbsoluteFill>
  );
};

export const ChartScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const tilt = interpolate(f, [0, 48], [1, 0], { ...clamp, easing: inOut });
  return (
    <AbsoluteFill>
      <Background tone="light" />
      {f < 48 && (
        <AbsoluteFill style={{ perspective: 1800 }}>
          <div style={{ position: "absolute", left: "50%", top: v ? "52%" : "56%", transformStyle: "preserve-3d",
            transform: `translate(-50%, -50%) rotateX(${12 + tilt * 14}deg) rotateY(${-8 + tilt * -14}deg) translateZ(${-200 * tilt}px)` }}>
            <div style={{ background: "rgba(255,255,255,.85)", borderRadius: 36, padding: v ? "40px 24px" : "48px 50px",
              boxShadow: "0 60px 140px rgba(15,92,67,.28), 0 0 0 3px rgba(31,138,99,.25)" }}>
              <DrawnChart start={2} end={40} width={v ? 1000 : 1500} />
            </div>
          </div>
        </AbsoluteFill>
      )}
      {f < 48 && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: v ? 250 : 40 }}>
            <Punch text="Watch the trend" at={0} until={44} size={v ? 120 : 120} color={C.ink} />
          </div>
          <BigStat x={v ? 70 : 1420} y={v ? 1450 : 190} label="90 days" from={0} to={-5.0} start={4} end={40} suffix=" kg" />
          <BigStat x={v ? 600 : 140} y={v ? 1450 : 190} label="Body fat" from={0} to={-2.9} start={8} end={40} suffix=" pts" color={C.warn} />
        </>
      )}
      <Sequence from={48}>
        <ChartFootage v={v} fps={fps} />
      </Sequence>
    </AbsoluteFill>
  );
};

const BigStat: React.FC<{ x: number; y: number; label: string; from: number; to: number; start: number; end: number; suffix: string; color?: string }> =
  ({ x, y, label, from, to, start, end, suffix, color = C.green }) => {
    const f = useCurrentFrame();
    const o = interpolate(f, [start - 4, start + 4], [0, 1], clamp);
    return (
      <div style={{ position: "absolute", left: x, top: y, opacity: o, transform: `translateY(${(1 - o) * 30}px)` }}>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 26, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted }}>{label}</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 110, lineHeight: 1, color }}>
          <Counter from={from} to={to} start={start} end={end} decimals={1} prefix="±" suffix={suffix} />
        </div>
      </div>
    );
  };

const ChartFootage: React.FC<{ v: boolean; fps: number }> = ({ v, fps }) => {
  const f = useCurrentFrame();
  const pose = v
    ? flyIn(f, fps, { y: -900, rx: -30 }, { y: 80, rx: 6, ry: 8 }, { ry: -10, z: 120 }, 48)
    : flyIn(f, fps, { x: -1500, ry: 60, z: -300 }, { x: -330, ry: 16, rx: 6 }, { ry: -6, z: 100 }, 48);
  return (
    <AbsoluteFill>
      <Screen clip="chart.mp4" trimBefore={66} width={v ? 980 : 1150} pose={pose} />
      <div style={{ position: "absolute", left: v ? 0 : "62%", right: v ? 0 : 40, top: v ? 300 : 330 }}>
        <Punch text={"Every range,\nevery metric"} at={0} size={v ? 110 : 90} color={C.ink} style={{ textAlign: v ? "center" : "left" }} />
      </div>
      <Tag at={8} style={v ? { left: 150, top: 1540 } : { left: "62.5%", top: 560 }} size={v ? 28 : 24}>7-day average · body fat</Tag>
      <Tag at={16} style={v ? { left: 200, top: 1630 } : { left: "62.5%", top: 640 }} size={v ? 28 : 24}>30 days to all time</Tag>
    </AbsoluteFill>
  );
};

export const DashboardScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const pose = v
    ? flyIn(f, fps, { z: -1600, rx: 30 }, { y: 60, rx: 10, ry: -10 }, { ry: 16, z: 160 }, 96)
    : flyIn(f, fps, { z: -1800, rx: 35, ry: 30 }, { x: 0, y: 80, rx: 14, ry: -8 }, { ry: 14, rx: -6, z: 200 }, 96);
  const cards: [string, string, string, boolean, number][] = [
    ["Weight", "81.35 kg", "▼ 0.25", true, 14], ["Body fat", "25.0 %", "▼ 0.2", true, 22], ["Water", "51.4 %", "▲ 0.1", true, 30], ["Visceral fat", "15.3", "▼ 0.1", true, 38],
  ];
  const spots = v ? [[60, 1260], [560, 1300], [80, 1500], [580, 1540]] : [[80, 330], [1490, 300], [70, 690], [1500, 660]];
  return (
    <AbsoluteFill>
      <Background tone="light" />
      <Screen clip="weighin.mp4" trimBefore={519} width={v ? 1000 : 1400} pose={pose} />
      <div style={{ position: "absolute", left: 0, right: 0, top: v ? 260 : 40 }}>
        <Punch text="Every number. Tracked." at={0} size={v ? 104 : 120} color={C.ink} />
      </div>
      {cards.map(([label, value, delta, good, at], i) => (
        <FloatCard key={label} at={at} x={spots[i][0]} y={spots[i][1]} label={label} value={value} delta={delta} good={good} />
      ))}
    </AbsoluteFill>
  );
};

const FloatCard: React.FC<{ at: number; x: number; y: number; label: string; value: string; delta: string; good: boolean }> = ({ at, x, y, label, value, delta, good }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 13, stiffness: 200 } });
  const bob = Math.sin((f + at * 3) / 14) * 8;
  return (
    <div style={{ position: "absolute", left: x, top: y + bob, transform: `perspective(900px) rotateY(${(1 - s) * 70}deg) scale(${0.6 + 0.4 * s})`,
      opacity: s, background: "#fff", borderRadius: 24, padding: "20px 28px", minWidth: 290,
      boxShadow: "0 24px 60px rgba(15,92,67,.25), 0 0 0 2px rgba(31,138,99,.18)", fontFamily: SANS }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18, justifyContent: "space-between" }}>
        <span style={{ fontWeight: 800, fontSize: 46, color: C.ink }}>{value}</span>
        <span style={{ fontWeight: 700, fontSize: 26, color: good ? "#1e8e3e" : "#c62828" }}>{delta}</span>
      </div>
      <div style={{ fontSize: 24, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
};
