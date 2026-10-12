import { OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { C } from "../lib";

export type Pose = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; scale?: number };

/**
 * A recorded clip of the live demo on a glowing screen floating in 3D space, like a projection:
 * glass edge, green glow, a moving glare and a faint reflection on the floor below.
 */
export const Screen: React.FC<{
  clip: string;            // file in public/footage
  trimBefore?: number;     // first frame of the clip to show
  playbackRate?: number;
  width: number;
  pose: Pose;
  blur?: number;
  reflection?: boolean;
  glow?: number;
  children?: React.ReactNode;
}> = ({ clip, trimBefore = 0, playbackRate = 1, width, pose, blur = 0, reflection = true, glow = 1, children }) => {
  const f = useCurrentFrame();
  const h = (width * 9) / 16;
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1 } = pose;
  const glare = ((f * 2.2) % 260) - 80;
  const face = (mirror: boolean) => (
    <div style={{ position: "absolute", left: -width / 2, top: mirror ? h / 2 + 24 : -h / 2, width, height: h, borderRadius: 22, overflow: "hidden",
      transform: mirror ? "scaleY(-1)" : undefined, opacity: mirror ? 0.16 : 1, background: C.bg,
      boxShadow: mirror ? undefined : `0 0 0 3px rgba(255,255,255,.75), 0 0 0 7px rgba(31,138,99,.35), 0 50px 120px rgba(15,92,67,${0.35 * glow}), 0 0 140px rgba(76,194,146,${0.45 * glow})`,
      WebkitMaskImage: mirror ? "linear-gradient(to top, black 0%, transparent 45%)" : undefined }}>
      <OffthreadVideo src={staticFile(`footage/${clip}`)} trimBefore={trimBefore} playbackRate={playbackRate} muted
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {!mirror && (
        <>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(115deg, transparent ${glare}%, rgba(255,255,255,.28) ${glare + 10}%, transparent ${glare + 24}%)` }} />
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, rgba(15,92,67,.035) 0 2px, transparent 2px 5px)" }} />
          <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 80px rgba(15,92,67,.18)" }} />
          {children}
        </>
      )}
    </div>
  );
  return (
    <div style={{ position: "absolute", left: "50%", top: "50%", perspective: 2200, perspectiveOrigin: "50% 40%", filter: blur ? `blur(${blur}px)` : undefined }}>
      <div style={{ transformStyle: "preserve-3d", transform: `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})` }}>
        {reflection && face(true)}
        {face(false)}
      </div>
    </div>
  );
};
