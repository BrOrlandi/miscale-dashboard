import { interpolate, useCurrentFrame } from "remotion";
import { ALEX, C, clamp, DISPLAY, movingAvg, outCubic, SANS } from "../lib";

// Alex's 90 days drawn in like the dashboard's chart: weigh-ins as dots, the 7-day average as a
// thick green line with a glowing pen at its tip, body fat as a dashed amber line.

const W = 1600, H = 640, PAD = { l: 90, r: 90, t: 30, b: 60 };
const [W_MIN, W_MAX] = [80.5, 87.5];
const [F_MIN, F_MAX] = [24, 29];
const x = (day: number) => PAD.l + (day / 90) * (W - PAD.l - PAD.r);
const yw = (w: number) => PAD.t + (1 - (w - W_MIN) / (W_MAX - W_MIN)) * (H - PAD.t - PAD.b);
const yf = (f: number) => PAD.t + (1 - (f - F_MIN) / (F_MAX - F_MIN)) * (H - PAD.t - PAD.b);
const fat = (day: number) => 27.9 - 2.9 * (day / 90) + 0.25 * Math.sin(day * 1.7) + 0.12 * Math.sin(day * 4.1);

const AVG = movingAvg(ALEX);
const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");

export const DrawnChart: React.FC<{ start: number; end: number; width: number; dark?: boolean }> = ({ start, end, width, dark }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [start, end], [0, 1], { ...clamp, easing: outCubic });
  const reveal = PAD.l + k * (W - PAD.l - PAD.r);
  const tipDay = k * 90;
  const tip = AVG.reduce((a, p) => (p.day <= tipDay ? p : a), AVG[0]);
  const grid = dark ? "rgba(255,255,255,.14)" : "rgba(28,29,31,.08)";
  const label = dark ? "rgba(255,255,255,.7)" : C.muted;
  return (
    <svg width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <defs>
        <clipPath id="reveal"><rect x={0} y={-50} width={reveal} height={H + 100} /></clipPath>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.bright} stopOpacity={0.28} />
          <stop offset="1" stopColor={C.bright} stopOpacity={0} />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      {[81, 82, 83, 84, 85, 86, 87].map((w) => (
        <g key={w}>
          <line x1={PAD.l} x2={W - PAD.r} y1={yw(w)} y2={yw(w)} stroke={grid} strokeWidth={2} />
          <text x={PAD.l - 18} y={yw(w) + 8} textAnchor="end" fontFamily={SANS} fontSize={24} fill={label}>{w}</text>
        </g>
      ))}
      {[25, 26, 27, 28].map((v) => (
        <text key={v} x={W - PAD.r + 18} y={yf(v) + 8} fontFamily={SANS} fontSize={24} fill={C.warn}>{v}%</text>
      ))}
      {[0, 30, 60, 90].map((d) => (
        <text key={d} x={x(d)} y={H - 18} textAnchor="middle" fontFamily={SANS} fontSize={24} fill={label}>{d === 90 ? "today" : `day ${d}`}</text>
      ))}
      <g clipPath="url(#reveal)">
        <path d={`${path(AVG.map((p) => [x(p.day), yw(p.weight)]))} L${x(90)} ${H - PAD.b} L${x(0)} ${H - PAD.b} Z`} fill="url(#area)" />
        <path d={path(ALEX.map((p) => [x(p.day), yf(fat(p.day))]))} fill="none" stroke={C.warn} strokeWidth={3} strokeDasharray="10 9" />
        {ALEX.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={yw(p.weight)} r={6} fill={dark ? "rgba(255,255,255,.8)" : C.muted}
            opacity={interpolate(tipDay - p.day, [0, 4], [0, 1], clamp)} />
        ))}
        <path d={path(AVG.map((p) => [x(p.day), yw(p.weight)]))} fill="none" stroke={C.mint} strokeWidth={14} opacity={0.35} filter="url(#glow)" />
        <path d={path(AVG.map((p) => [x(p.day), yw(p.weight)]))} fill="none" stroke={dark ? "#fff" : C.green} strokeWidth={7}
          strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {k > 0 && k < 1 && (
        <g>
          <circle cx={x(tip.day)} cy={yw(tip.weight)} r={22} fill={C.mint} opacity={0.35} filter="url(#glow)" />
          <circle cx={x(tip.day)} cy={yw(tip.weight)} r={10} fill={dark ? "#fff" : C.deep} />
          <text x={x(tip.day)} y={yw(tip.weight) - 30} textAnchor="middle" fontFamily={DISPLAY} fontSize={44} fill={dark ? "#fff" : C.deep}>
            {tip.weight.toFixed(1)}
          </text>
        </g>
      )}
    </svg>
  );
};
