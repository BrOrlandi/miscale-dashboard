import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { continueRender, delayRender } from "remotion";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, SANS } from "../lib";

export const SCALE_W = 0.36, SCALE_H = 0.028, LEG_H = 0.006;
export const SCALE_TOP = SCALE_H + LEG_H;
export const DISPLAY_Z = 0.152;

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new THREE.ShapeGeometry(s, 8);
}

/**
 * A generic glass body-composition scale: white rounded slab, four electrode pads and a hidden
 * LED display that lights up in the dashboard's green. `text` is what the display shows ("" is
 * off) and `glow` brightens it when the weight locks.
 */
export const ScaleModel: React.FC<{ text: string; glow: number; ring: number }> = ({ text, glow, ring }) => {
  const body = useMemo(() => new RoundedBoxGeometry(SCALE_W, SCALE_H, SCALE_W, 6, 0.012), []);
  const pad = useMemo(() => roundedRect(0.1, 0.08, 0.022), []);
  const canvas = useMemo(() => { const c = document.createElement("canvas"); c.width = 1024; c.height = 256; return c; }, []);
  const tex = useMemo(() => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }, [canvas]);
  const halo = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(76,194,146,0.9)"); g.addColorStop(1, "rgba(76,194,146,0)");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);

  // The canvas can only use the web font once it has loaded.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    const handle = delayRender("display font");
    Promise.all([document.fonts.load(`800 210px ${SANS}`), document.fonts.load(`700 90px ${SANS}`)])
      .then(() => { setFontReady(true); continueRender(handle); });
  }, []);

  useLayoutEffect(() => {
    if (!fontReady) return;
    const x = canvas.getContext("2d")!;
    x.clearRect(0, 0, 1024, 256);
    if (!text) { tex.needsUpdate = true; return; }
    x.textBaseline = "middle";
    x.shadowColor = "rgba(31,138,99,0.9)";
    x.shadowBlur = 18 + glow * 30;
    x.fillStyle = glow > 0.5 ? C.bright : C.green;
    x.font = `800 210px ${SANS}`;
    x.textAlign = "right";
    x.fillText(text, 820, 140);
    x.font = `700 90px ${SANS}`;
    x.textAlign = "left";
    x.fillText("kg", 840, 172);
    tex.needsUpdate = true;
  }, [canvas, tex, text, glow, fontReady]);

  return (
    <group>
      <mesh geometry={body} position={[0, LEG_H + SCALE_H / 2, 0]}>
        <meshPhysicalMaterial color="#ffffff" roughness={0.18} clearcoat={1} clearcoatRoughness={0.08} sheen={0.2} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
        <mesh key={`f${sx}${sz}`} position={[sx * 0.145, LEG_H / 2, sz * 0.145]}>
          <cylinderGeometry args={[0.012, 0.012, LEG_H, 16]} />
          <meshStandardMaterial color="#c9d1cd" />
        </mesh>
      ))}
      {[[-0.085, -0.08], [-0.085, 0.08], [0.09, -0.08], [0.09, 0.08]].map(([px, pz]) => (
        <mesh key={`p${px}${pz}`} geometry={pad} position={[px, SCALE_TOP + 0.0003, pz - 0.012]} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#e6ecea" roughness={0.3} metalness={0.05} />
        </mesh>
      ))}
      <mesh position={[0, SCALE_TOP + 0.0006, DISPLAY_Z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[0.18, 0.045]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {text && (
        <mesh position={[0, SCALE_TOP + 0.0005, DISPLAY_Z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <planeGeometry args={[0.2, 0.07]} />
          <meshBasicMaterial map={halo} transparent opacity={0.18 + glow * 0.35} toneMapped={false} depthWrite={false} />
        </mesh>
      )}
      {/* A glowing ring on the floor around the scale, flashing on impacts. */}
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.43 + ring * 0.02, 96]} />
        <meshBasicMaterial color={C.bright} transparent opacity={0.35 + ring * 0.6} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.43 + (1 - ring) * 0.6, 0.44 + (1 - ring) * 0.64, 96]} />
        <meshBasicMaterial color={C.mint} transparent opacity={ring * 0.5} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
};
