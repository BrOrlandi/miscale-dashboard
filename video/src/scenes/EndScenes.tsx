import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Logo } from "../components/Logo";
import { Punch } from "../components/Text";
import { C, clamp, DEMO, DISPLAY, inOut, pulse, REPO, SANS, useVertical } from "../lib";

// Beats 80-88: "Free." and "Open source." on two hits. Beats 88-102: the signature, the logo
// with the repository and live demo links, with the final hit on beat 92 (local frame 48).

export const FreeScene: React.FC = () => {
  const f = useCurrentFrame();
  const v = useVertical();
  const up = interpolate(f, [44, 54], [0, 1], { ...clamp, easing: inOut });
  const size = v ? 300 : 340;
  return (
    <AbsoluteFill>
      <Background tone="green" speed={2} />
      <AbsoluteFill style={{ background: "#fff", opacity: pulse(f, [0, 48], 2.5) * 0.45 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: (v ? 640 : 300) - up * (v ? 260 : 210), transform: `scale(${1 - up * 0.42})` }}>
        <Punch text="Free." at={0} size={size} color={C.white} accent={C.deep} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: v ? 760 : 470 }}>
        <Punch text={v ? "Open\nsource." : "Open source."} at={48} size={v ? 230 : 230} color={C.white} accent={C.deep} />
      </div>
      <Sub f={f} at={10} until={44} text={v ? "No subscription\nno account · no cloud" : "No subscription · no account · no cloud"} top={v ? 1000 : 680} />
      <Sub f={f} at={58} text="MIT licensed · self-hosted" top={v ? 1290 : 760} />
    </AbsoluteFill>
  );
};

const Sub: React.FC<{ f: number; at: number; until?: number; text: string; top: number }> = ({ f, at, until, text, top }) => {
  if (f < at) return null;
  const o = interpolate(f, [at, at + 6], [0, 1], clamp) * (until ? interpolate(f, [until, until + 4], [1, 0], clamp) : 1);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, textAlign: "center", fontFamily: SANS, fontWeight: 700, fontSize: 40,
      letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "pre-line", lineHeight: 1.4, color: "rgba(255,255,255,.9)", opacity: o, transform: `translateY(${(1 - o) * 20}px)` }}>
      {text}
    </div>
  );
};

export const EndScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const pop = spring({ frame: f, fps, config: { damping: 12, stiffness: 160 } });
  const draw = interpolate(f, [4, 26], [0, 1], { ...clamp, easing: inOut });
  const needle = spring({ frame: f - 10, fps, config: { damping: 8, stiffness: 120 } });
  const hit = pulse(f, [48], 5);
  const zoom = 1 + interpolate(f, [0, 168], [0, 0.05]);
  const line = (at: number) => {
    const o = interpolate(f, [at, at + 8], [0, 1], clamp);
    return { opacity: o, transform: `translateY(${(1 - o) * 24}px)` };
  };
  const logo = v ? 300 : 260;
  return (
    <AbsoluteFill>
      <Background tone="light" speed={0.5} bands={false} />
      <AbsoluteFill style={{ background: "#fff", opacity: hit * 0.5 }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${zoom + hit * 0.04})` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: v ? 34 : 26 }}>
          <div style={{ transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)`, filter: "drop-shadow(0 30px 50px rgba(15,92,67,.35))" }}>
            <Logo size={logo} draw={draw} needle={needle} style={{ display: "block" }} />
          </div>
          <div style={{ fontFamily: DISPLAY, fontSize: v ? 120 : 120, color: C.ink, lineHeight: 1, textTransform: "uppercase", textAlign: "center", ...line(8) }}>
            Mi Scale Dashboard
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: v ? 36 : 34, color: C.green, letterSpacing: "0.18em", textTransform: "uppercase", ...line(14) }}>
            Free · Open source
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: v ? 40 : 18 }}>
            <Link at={20} f={f} big text={REPO} icon="code" v={v} />
            <Link at={28} f={f} text={`Live demo: ${DEMO}`} icon="play" v={v} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Link: React.FC<{ at: number; f: number; text: string; icon: "code" | "play"; big?: boolean; v: boolean }> = ({ at, f, text, icon, big, v }) => {
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - at, fps, config: { damping: 14, stiffness: 180 } });
  if (f < at) return null;
  const size = big ? (v ? 40 : 44) : v ? 30 : 32;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: SANS, fontWeight: big ? 800 : 600, fontSize: size,
      color: big ? "#fff" : C.deep, background: big ? C.green : "rgba(255,255,255,.9)", padding: big ? "18px 34px" : "12px 26px", borderRadius: 999,
      boxShadow: big ? "0 20px 50px rgba(15,92,67,.35)" : "0 0 0 2px rgba(31,122,90,.25)", transform: `scale(${0.7 + 0.3 * s})`, opacity: s,
      maxWidth: v ? 1000 : undefined, whiteSpace: "nowrap" }}>
      {icon === "code" ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
        </svg>
      ) : (
        <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill="currentColor" /></svg>
      )}
      {text}
    </div>
  );
};
