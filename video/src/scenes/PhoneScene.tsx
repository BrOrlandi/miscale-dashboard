import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Logo } from "../components/Logo";
import { Punch, Tag } from "../components/Text";
import { C, clamp, SANS, useVertical } from "../lib";

// Beats 64-80: a generic phone with a generic chat app. Every weigh-in arrives as a message with
// the weight (beat 66), and once a week the AI analysis (beat 72). Each comes with a heads-up
// notification sliding down from the top, on the pings in the soundtrack.

const PHONE_W = 420, PHONE_H = 860;
const WEIGH_IN = 24, WEEKLY = 96;   // local frames: beats 66 and 72

const NOTE_1 = "⚖️ Alex · 81.4 kg · −0.4 kg this week";
const NOTE_2_TITLE = "🤖 Weekly analysis · Alex";
const NOTE_2 = "Down 0.6 kg this week and your muscle held. Keep protein at every meal, add a third strength session and aim for 7–8 h of sleep.";

export const PhoneScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVertical();
  const enter = spring({ frame: f, fps, config: { damping: 16, stiffness: 120 } });
  const bob = Math.sin(f / 18) * 10;
  const scale = v ? 1.42 : 1.16;
  const turn = interpolate(f, [0, 192], [-22, -8], clamp);
  return (
    <AbsoluteFill>
      <Background tone="light" />
      <div style={{ position: "absolute", left: v ? "50%" : "66%", top: v ? "53%" : "50%", perspective: 1800 }}>
        <div style={{ transform: `translate(-50%, -50%) translateY(${(1 - enter) * 900 + bob}px) rotateY(${turn}deg) rotateX(${6 - (1 - enter) * 30}deg) rotateZ(${v ? 0 : 3}deg) scale(${scale})`,
          transformStyle: "preserve-3d" }}>
          <Phone f={f} />
        </div>
      </div>
      <div style={{ position: "absolute", left: v ? 0 : 100, right: v ? 0 : "48%", top: v ? 170 : 250 }}>
        <Punch text={"On your\nphone."} at={0} size={v ? 150 : 150} color={C.ink} style={{ textAlign: v ? "center" : "left" }} />
      </div>
      <Tag at={WEIGH_IN} style={v ? { left: 345, top: 1730 } : { left: 104, top: 600 }} size={v ? 30 : 28}>Every weigh-in</Tag>
      <Tag at={WEEKLY} style={v ? { left: 177, top: 1820 } : { left: 104, top: 690 }} size={v ? 30 : 28}>Every week: your AI analysis</Tag>
    </AbsoluteFill>
  );
};

const Phone: React.FC<{ f: number }> = ({ f }) => (
  <div style={{ width: PHONE_W, height: PHONE_H, borderRadius: 58, background: "#15181a", padding: 12, position: "relative",
    boxShadow: "0 0 0 3px #2b3033, 0 70px 140px rgba(15,92,67,.35), 0 20px 50px rgba(0,0,0,.25)" }}>
    <div style={{ width: "100%", height: "100%", borderRadius: 46, overflow: "hidden", position: "relative", background: "#e7f0eb", fontFamily: SANS }}>
      <StatusBar />
      <ChatHeader />
      <Chat f={f} />
      <InputBar />
      <Banner f={f} at={WEIGH_IN} title="Mi Scale" text={NOTE_1} />
      <Banner f={f} at={WEEKLY} title="Mi Scale · weekly analysis" text={NOTE_2} />
      <div style={{ position: "absolute", top: 12, left: "50%", width: 16, height: 16, marginLeft: -8, borderRadius: "50%", background: "#0b0d0e", zIndex: 30 }} />
    </div>
  </div>
);

const StatusBar = () => (
  <div style={{ height: 40, background: C.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 26px", fontSize: 15, fontWeight: 700 }}>
    <span>7:12</span>
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <svg width="18" height="12" viewBox="0 0 18 12"><path d="M1 11h2V8H1zM5 11h2V6H5zM9 11h2V3H9zM13 11h2V0h-2z" fill="#fff" /></svg>
      <svg width="24" height="12" viewBox="0 0 24 12"><rect x="0.5" y="0.5" width="20" height="11" rx="3" fill="none" stroke="#fff" /><rect x="2" y="2" width="14" height="8" rx="1.5" fill="#fff" /><rect x="21.5" y="4" width="2" height="4" rx="1" fill="#fff" /></svg>
    </span>
  </div>
);

const ChatHeader = () => (
  <div style={{ height: 70, background: C.green, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", color: "#fff" }}>
    <svg width="14" height="22" viewBox="0 0 14 22"><path d="M11 2L3 11l8 9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <Logo size={46} style={{ borderRadius: 23 }} />
    <div>
      <div style={{ fontWeight: 800, fontSize: 19 }}>Mi Scale</div>
      <div style={{ fontSize: 14, opacity: 0.85 }}>bot</div>
    </div>
  </div>
);

const Bubble: React.FC<{ f: number; at: number; time: string; children: React.ReactNode }> = ({ f, at, time, children }) => {
  const { fps } = useVideoConfig();
  if (f < at) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 14, stiffness: 200 } });
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "86%", background: "#fff", borderRadius: "20px 20px 20px 6px", padding: "12px 16px 8px",
      boxShadow: "0 2px 4px rgba(0,0,0,.08)", transform: `scale(${0.7 + 0.3 * s})`, transformOrigin: "0% 100%", opacity: s, fontSize: 18,
      lineHeight: 1.38, color: C.ink }}>
      {children}
      <div style={{ fontSize: 12, color: C.muted, textAlign: "right", marginTop: 4 }}>{time}</div>
    </div>
  );
};

const DateChip: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ alignSelf: "center", background: "rgba(15,92,67,.12)", color: C.deep, fontSize: 13, fontWeight: 700, padding: "5px 12px", borderRadius: 999 }}>{text}</div>
);

const Chat: React.FC<{ f: number }> = ({ f }) => {
  const typing = f >= WEEKLY - 14 && f < WEEKLY;
  return (
    <div style={{ position: "absolute", top: 110, bottom: 64, left: 0, right: 0, overflow: "hidden",
      backgroundImage: "radial-gradient(rgba(31,122,90,.12) 1.5px, transparent 1.6px)", backgroundSize: "22px 22px" }}>
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <DateChip text="Yesterday" />
        <Bubble f={f} at={-1} time="07:31">⚖️ Alex · 81.6 kg · −0.3 kg this week</Bubble>
        <DateChip text="Today" />
        <Bubble f={f} at={WEIGH_IN} time="07:12">{NOTE_1}</Bubble>
        {typing && (
          <div style={{ alignSelf: "flex-start", background: "#fff", borderRadius: 18, padding: "14px 18px", display: "flex", gap: 6 }}>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: C.muted,
              opacity: 0.35 + 0.65 * Math.max(0, Math.sin((f - i * 3) / 3)) }} />)}
          </div>
        )}
        <Bubble f={f} at={WEEKLY} time="Sat 09:00">
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{NOTE_2_TITLE}</div>
          {NOTE_2}
        </Bubble>
      </div>
    </div>
  );
};

const InputBar = () => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 64, background: "#f7faf8", display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
    <div style={{ flex: 1, height: 40, borderRadius: 20, background: "#fff", border: "1px solid #dde5e1", color: "#9aa3a0", fontSize: 16, display: "flex", alignItems: "center", paddingLeft: 16 }}>Message</div>
    <div style={{ width: 40, height: 40, borderRadius: 20, background: C.green }} />
  </div>
);

const Banner: React.FC<{ f: number; at: number; title: string; text: string }> = ({ f, at, title, text }) => {
  const { fps } = useVideoConfig();
  if (f < at || f > at + 60) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 15, stiffness: 180 } });
  const out = interpolate(f, [at + 48, at + 60], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 10, right: 10, top: 8 + (s - 1) * 140 - out * 140, zIndex: 20, background: "rgba(255,255,255,.97)",
      borderRadius: 22, padding: "12px 14px", display: "flex", gap: 12, boxShadow: "0 14px 40px rgba(0,0,0,.25)" }}>
      <Logo size={40} style={{ flex: "none", borderRadius: 10 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, fontWeight: 600 }}>
          <span>{title}</span><span>now</span>
        </div>
        <div style={{ fontSize: 16, color: C.ink, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text}</div>
      </div>
    </div>
  );
};
