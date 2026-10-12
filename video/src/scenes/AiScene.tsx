import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Screen } from "../components/Screen";
import { Punch, Tag } from "../components/Text";
import { C, clamp, DISPLAY, SANS, useVertical } from "../lib";

// Beats 48-64 on the green backdrop: "AI coach", then the weekly analysis typed in big, next to
// the real dashboard typing its own analysis on a projected screen.

type Piece = { text: string; strong?: boolean; br?: boolean };
const ANALYSIS: Piece[] = [
  { text: "Alex, you're " }, { text: "1.7 kg lighter", strong: true }, { text: " in four weeks, and it's mostly fat: muscle held at 58 kg." },
  { text: "", br: true }, { text: "Diet: ", strong: true }, { text: "protein at every meal, about 1.6 g per kg." },
  { text: "", br: true }, { text: "Training: ", strong: true }, { text: "add a third strength session." },
  { text: "", br: true }, { text: "Recovery: ", strong: true }, { text: "7–8 h of sleep keeps the readings steady." },
];
const TOTAL = ANALYSIS.reduce((n, p) => n + p.text.length, 0);
const TYPE_START = 48, TYPE_END = 166;

const Typed: React.FC<{ shown: number; size: number }> = ({ shown, size }) => {
  let left = shown;
  const out: React.ReactNode[] = [];
  ANALYSIS.forEach((p, i) => {
    if (p.br) { if (left > 0 || shown >= TOTAL) out.push(<div key={i} style={{ height: size * 0.55 }} />); return; }
    const n = Math.max(0, Math.min(p.text.length, left));
    left -= p.text.length;
    if (n > 0) out.push(<span key={i} style={p.strong ? { color: C.deep, fontWeight: 800 } : undefined}>{p.text.slice(0, n)}</span>);
  });
  return <>{out}</>;
};

export const AiScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const shown = Math.round(interpolate(f, [TYPE_START, TYPE_END], [0, TOTAL], clamp));
  const caretOn = Math.floor(f / 8) % 2 === 0 || shown < TOTAL;
  const cardIn = spring({ frame: f - 34, fps, config: { damping: 16, stiffness: 150 } });
  const screenIn = spring({ frame: f - 40, fps, config: { damping: 18, stiffness: 110 } });
  const drift = interpolate(f, [40, 192], [0, 1], clamp);
  const size = v ? 46 : 44;
  return (
    <AbsoluteFill>
      <Background tone="green" />
      {/* Title: AI coach */}
      <div style={{ position: "absolute", left: 0, right: 0, top: v ? 700 : 330 }}>
        <Punch text="AI coach" at={0} until={30} size={v ? 260 : 300} color={C.white} accent={C.deep} />
      </div>
      <Sparkles f={f} />
      {f >= 34 && (
        <>
          <Screen clip="weighin.mp4" trimBefore={630} playbackRate={1.4} width={v ? 900 : 980} glow={1.4}
            pose={v
              ? { y: 380 + (1 - screenIn) * 900, rx: 10, ry: -8 + drift * 12, z: drift * 80 }
              : { x: 500 + (1 - screenIn) * 1200, y: 110, ry: -20 + drift * 8, rx: 6, z: -60 + drift * 100 }} />
          <div style={{ position: "absolute", left: v ? 60 : 90, top: v ? 250 : 210, width: v ? 960 : 900,
            transform: `perspective(1600px) rotateY(${(1 - cardIn) * -40 + (v ? 0 : 6)}deg) translateX(${(1 - cardIn) * -600}px)`, opacity: cardIn,
            background: "#fff", borderRadius: 34, padding: v ? "38px 44px" : "36px 44px", boxShadow: "0 50px 120px rgba(0,0,0,.35), 0 0 0 3px rgba(255,255,255,.4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: v ? 26 : 22, letterSpacing: "0.16em", color: C.muted, textTransform: "uppercase" }}>
                Weekly analysis · Alex
              </div>
              <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: v ? 24 : 20, color: C.green, background: C.soft, padding: "8px 18px", borderRadius: 999 }}>
                {shown < TOTAL ? "Writing…" : "AI · just now"}
              </div>
            </div>
            <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: size, lineHeight: 1.32, color: C.ink, minHeight: size * 1.32 * (v ? 9 : 8.6) }}>
              <Typed shown={shown} size={size} />
              <span style={{ display: "inline-block", width: size * 0.45, height: size * 0.95, marginLeft: 4, verticalAlign: "-0.15em",
                background: C.bright, opacity: caretOn ? 1 : 0 }} />
            </div>
          </div>
        </>
      )}
      <Tag at={60} dark style={v ? { left: 150, top: 1720 } : { left: 100, top: 850 }} size={v ? 30 : 26}>Analyzes your progress</Tag>
      <Tag at={108} dark style={v ? { left: 110, top: 1800 } : { left: 100, top: 935 }} size={v ? 30 : 26}>Recommends diet &amp; training</Tag>
      <AiBadge f={f} v={v} />
    </AbsoluteFill>
  );
};

const AiBadge: React.FC<{ f: number; v: boolean }> = ({ f, v }) => {
  if (f < 140) return null;
  const k = interpolate(f, [140, 150], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", right: v ? 60 : 90, top: v ? 120 : 60, opacity: k, transform: `scale(${0.8 + 0.2 * k})`,
      fontFamily: DISPLAY, fontSize: v ? 64 : 56, color: C.white, textTransform: "uppercase", textAlign: "right", lineHeight: 1 }}>
      Every week.
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: v ? 26 : 22, letterSpacing: "0.1em", opacity: 0.8, marginTop: 8 }}>OpenAI · OpenRouter · local Ollama</div>
    </div>
  );
};

const Sparkles: React.FC<{ f: number }> = ({ f }) => {
  const { width, height } = useVideoConfig();
  return (
    <>
      {Array.from({ length: 14 }, (_, i) => {
        const r = (n: number) => ((Math.sin(i * 91.7 + n * 47.3) * 9973.13) % 1 + 1) % 1;
        const life = ((f + r(1) * 60) % 60) / 60;
        const s = Math.sin(Math.PI * life);
        return (
          <svg key={i} width={40} height={40} viewBox="-10 -10 20 20" style={{ position: "absolute", left: r(2) * width, top: r(3) * height,
            opacity: s * 0.7, transform: `scale(${0.4 + s}) rotate(${f * 2}deg)` }}>
            <path d="M0 -10 L2 -2 L10 0 L2 2 L0 10 L-2 2 L-10 0 L-2 -2 Z" fill="#fff" />
          </svg>
        );
      })}
    </>
  );
};
