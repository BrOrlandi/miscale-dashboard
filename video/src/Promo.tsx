import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { beat, clamp, pulse, scene, T } from "./lib";
import { AiScene } from "./scenes/AiScene";
import { EndScene, FreeScene } from "./scenes/EndScenes";
import { PhoneScene } from "./scenes/PhoneScene";
import { ScaleScene } from "./scenes/ScaleScene";
import { ChartScene, DashboardScene, LiveScene } from "./scenes/ScreenScenes";

// The whole video. Scenes start on the beats in src/timeline.json, the same grid the soundtrack
// (scripts/make_music.mjs) is written on, so every cut lands on a hit.

const IMPACTS = T.cues.impact.map(beat);

/** Every cut punches in: a quick zoom and blur settling over the first frames of the scene. */
const Cut: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [0, 7], [1, 0], clamp);
  return <AbsoluteFill style={{ transform: `scale(${1 + k * k * 0.12})`, filter: k > 0.02 ? `blur(${k * k * 10}px)` : undefined }}>{children}</AbsoluteFill>;
};

const Part: React.FC<{ id: string; through?: string; children: React.ReactNode }> = ({ id, through, children }) => {
  const a = scene(id), b = scene(through ?? id);
  return (
    <Sequence from={a.from} durationInFrames={b.from + b.frames - a.from} name={id}>
      <Cut>{children}</Cut>
    </Sequence>
  );
};

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  const kick = pulse(f, IMPACTS, 4);
  const shakeX = Math.sin(f * 2.7) * kick * 14, shakeY = Math.cos(f * 3.3) * kick * 10;
  return (
    <AbsoluteFill style={{ background: "#f5f5f2", overflow: "hidden" }}>
      <Audio src={staticFile("audio/soundtrack.wav")} />
      <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px) scale(${1 + kick * 0.015})` }}>
        <Part id="intro" through="scale"><ScaleScene /></Part>
        <Part id="live"><LiveScene /></Part>
        <Part id="chart"><ChartScene /></Part>
        <Part id="dashboard"><DashboardScene /></Part>
        <Part id="ai"><AiScene /></Part>
        <Part id="phone"><PhoneScene /></Part>
        <Part id="free"><FreeScene /></Part>
        <Part id="end"><EndScene /></Part>
      </AbsoluteFill>
      {/* A thin flash on every hit, and a vignette over everything. */}
      <AbsoluteFill style={{ background: "#ffffff", opacity: kick * 0.18, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
