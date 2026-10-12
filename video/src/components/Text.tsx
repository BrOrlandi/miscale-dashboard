import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp, DISPLAY, SANS } from "../lib";

type PunchProps = {
  text: string;
  at: number;          // local frame it slams in
  until?: number;      // local frame it leaves
  size?: number;
  color?: string;
  accent?: string;     // color of the offset "echo" behind the letters
  style?: React.CSSProperties;
  from?: "zoom" | "up" | "left" | "right";
};

/** A headline that slams in on a beat: oversized, then snaps to place with a colored echo. */
export const Punch: React.FC<PunchProps> = ({ text, at, until, size = 160, color = C.ink, accent = C.bright, style, from = "zoom" }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < at || (until != null && f >= until + 6)) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 14, stiffness: 260, mass: 0.6 } });
  const out = until == null ? 0 : interpolate(f, [until, until + 6], [0, 1], clamp);
  const scale = from === "zoom" ? interpolate(s, [0, 1], [2.2, 1]) : 1;
  const dx = from === "left" ? interpolate(s, [0, 1], [-400, 0]) : from === "right" ? interpolate(s, [0, 1], [400, 0]) : 0;
  const dy = from === "up" ? interpolate(s, [0, 1], [220, 0]) : 0;
  const blur = interpolate(f - at, [0, 4], [12, 0], clamp) + out * 14;
  const echo = interpolate(f - at, [0, 10], [18, 6], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: DISPLAY, fontSize: size, lineHeight: 0.95,
      color, letterSpacing: "0.01em", textTransform: "uppercase", whiteSpace: "pre-line",
      transform: `translate(${dx}px, ${dy - out * 60}px) scale(${scale * (1 + out * 0.4)})`, opacity: Math.min(1, (f - at + 1) / 2) * (1 - out),
      filter: `blur(${blur}px)`, textShadow: `${echo}px ${echo}px 0 ${accent}`, ...style }}>
      {text}
    </div>
  );
};

/** A small rounded label, like the dashboard's chips. */
export const Tag: React.FC<{ children: React.ReactNode; at: number; dark?: boolean; style?: React.CSSProperties; size?: number }> =
  ({ children, at, dark, style, size = 30 }) => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    if (f < at) return null;
    const s = spring({ frame: f - at, fps, config: { damping: 16, stiffness: 220 } });
    return (
      <div style={{ position: "absolute", fontFamily: SANS, fontWeight: 700, fontSize: size, letterSpacing: "0.12em", textTransform: "uppercase",
        padding: `${size * 0.45}px ${size * 0.9}px`, borderRadius: 999, color: dark ? C.white : C.deep,
        background: dark ? "rgba(255,255,255,.14)" : C.soft, border: `2px solid ${dark ? "rgba(255,255,255,.35)" : "rgba(31,122,90,.35)"}`,
        transform: `translateY(${(1 - s) * 40}px) scale(${0.8 + 0.2 * s})`, opacity: s, whiteSpace: "nowrap", ...style }}>
        {children}
      </div>
    );
  };

/** A number that counts from `from` to `to` between two frames, with a little overshoot jitter on the way. */
export const Counter: React.FC<{ from: number; to: number; start: number; end: number; decimals?: number; prefix?: string; suffix?: string;
  style?: React.CSSProperties }> = ({ from, to, start, end, decimals = 1, prefix = "", suffix = "", style }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [start, end], [0, 1], clamp);
  const eased = 1 - (1 - k) ** 3;
  const jitter = k > 0 && k < 1 ? Math.sin(f * 2.3) * (1 - k) * Math.abs(to - from) * 0.04 : 0;
  const v = from + (to - from) * eased + jitter;
  const sign = prefix === "±" ? (v < 0 ? "−" : "+") : prefix;
  const shown = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{sign}{prefix === "±" ? shown : (v < 0 ? "−" : "") + shown}{suffix}</span>;
};
