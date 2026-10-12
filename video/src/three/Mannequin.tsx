import { useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

// A simple jointed figure drawn only as a glowing outline of its silhouette. Every body part is
// drawn four times, with the stencil buffer keeping the passes apart:
//   1. mask:    the plain shape, writes stencil 1 and no color;
//   2. fill:    a faint tint, once per pixel inside the shape (stencil 1 -> 2);
//   3. outline: the shape pushed outward along its screen-space normals, drawn only where the
//      stencil is still 0, so only a band outside the whole figure's silhouette is left;
//   4. glow:    two wider, fainter bands outside that.
// So overlapping parts merge into one clean contour, like a single outline drawn around a body.

const vert = /* glsl */ `
  uniform float px;
  uniform vec2 resolution;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(viewMatrix) * normalize(mat3(modelMatrix) * normal));
    vec4 clip = projectionMatrix * viewMatrix * world;
    vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
    float l = length(dir);
    if (l > 1e-5) clip.xy += dir / l * px * 2.0 / resolution * clip.w;
    gl_Position = clip;
  }`;
const frag = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  void main() { gl_FragColor = vec4(color, opacity); }`;

type Mats = { mask: THREE.Material; fill: THREE.Material; bands: THREE.ShaderMaterial[] };

export function useOutlineMaterials(color: string, scale: number): Mats {
  const size = useThree((s) => s.size);
  return useMemo(() => {
    const stencil = (ref: number, func: THREE.StencilFunc, op: THREE.StencilOp) => ({
      depthTest: false, depthWrite: false, stencilWrite: true, stencilRef: ref, stencilFunc: func,
      stencilZPass: op, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
    });
    const mask = new THREE.MeshBasicMaterial({ colorWrite: false, ...stencil(1, THREE.AlwaysStencilFunc, THREE.ReplaceStencilOp) });
    const fill = new THREE.MeshBasicMaterial({ color: "#4cc292", transparent: true, opacity: 0.07, ...stencil(1, THREE.EqualStencilFunc, THREE.IncrementStencilOp) });
    const band = (px: number, opacity: number) => new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: opacity < 1,
      uniforms: { px: { value: px * scale }, resolution: { value: new THREE.Vector2(size.width, size.height) },
        color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
      ...stencil(0, THREE.EqualStencilFunc, THREE.IncrementStencilOp),
    });
    return { mask, fill, bands: [band(4, 1), band(10, 0.3), band(22, 0.1)] };
  }, [color, scale, size.width, size.height]);
}

/** One body part: the same geometry through the four passes. */
const Part: React.FC<{ geo: THREE.BufferGeometry; mats: Mats; position?: [number, number, number];
  rotation?: [number, number, number]; scale?: [number, number, number] }> = ({ geo, mats, ...t }) => (
  <group {...t}>
    <mesh geometry={geo} material={mats.mask} renderOrder={10} />
    <mesh geometry={geo} material={mats.fill} renderOrder={11} />
    {mats.bands.map((m, i) => <mesh key={i} geometry={geo} material={m} renderOrder={12 + i} />)}
  </group>
);

export type Pose = {
  root: [number, number, number];   // hip joint level, world
  facing: number;                    // rotation about y
  lean: number;                      // torso pitch forward
  head: number;                      // head pitch (looking down)
  legs: { hip: number; knee: number; ankle: number }[];   // [right, left]
  arms: number[];                    // shoulder swing, [right, left]
};

export const THIGH = 0.43, SHIN = 0.43, SOLE = 0.075, HIP_W = 0.075;

/** Two-bone IK in the leg's plane: hip flex and knee flex that put the ankle at (forward, down). */
export function legIK(forward: number, down: number) {
  const d = Math.min(Math.hypot(forward, down), THIGH + SHIN - 1e-4);
  const knee = Math.PI - Math.acos((THIGH ** 2 + SHIN ** 2 - d ** 2) / (2 * THIGH * SHIN));
  const hip = Math.atan2(forward, down) + Math.acos((THIGH ** 2 + d ** 2 - SHIN ** 2) / (2 * THIGH * d));
  return { hip, knee, ankle: hip - knee };
}

export const Mannequin: React.FC<{ pose: Pose; color: string; scale?: number }> = ({ pose, color, scale = 1 }) => {
  const mats = useOutlineMaterials(color, scale);
  const g = useMemo(() => ({
    pelvis: new THREE.SphereGeometry(1, 32, 20),
    torso: new THREE.CapsuleGeometry(0.13, 0.3, 10, 24),
    neck: new THREE.CapsuleGeometry(0.045, 0.06, 6, 16),
    head: new THREE.SphereGeometry(0.1, 32, 24),
    upper: new THREE.CapsuleGeometry(0.045, 0.22, 8, 16),
    fore: new THREE.CapsuleGeometry(0.038, 0.2, 8, 16),
    hand: new THREE.SphereGeometry(0.045, 16, 12),
    thigh: new THREE.CapsuleGeometry(0.072, THIGH - 0.1, 8, 20),
    shin: new THREE.CapsuleGeometry(0.052, SHIN - 0.08, 8, 20),
    foot: new THREE.CapsuleGeometry(0.037, 0.13, 6, 16),
  }), []);
  const P = (geo: THREE.BufferGeometry, p?: [number, number, number], r?: [number, number, number], s?: [number, number, number]) =>
    <Part geo={geo} mats={mats} position={p} rotation={r} scale={s} />;
  return (
    <group position={pose.root} rotation={[0, pose.facing, 0]}>
      {P(g.pelvis, [0, 0.03, 0], undefined, [0.16, 0.11, 0.11])}
      <group position={[0, 0.06, 0]} rotation={[pose.lean, 0, 0]}>
        {P(g.torso, [0, 0.27, 0], undefined, [1.2, 1, 0.72])}
        {P(g.neck, [0, 0.53, 0.01])}
        <group position={[0, 0.58, 0.01]} rotation={[pose.head, 0, 0]}>
          {P(g.head, [0, 0.08, 0.01], undefined, [0.92, 1.08, 1])}
        </group>
        {[1, -1].map((side, i) => (
          <group key={side} position={[side * -0.2, 0.47, 0]} rotation={[-pose.arms[i], 0, side * -0.06]}>
            {P(g.upper, [0, -0.15, 0])}
            <group position={[0, -0.3, 0]} rotation={[-0.25 - Math.max(0, pose.arms[i]) * 0.6, 0, 0]}>
              {P(g.fore, [0, -0.13, 0])}
              {P(g.hand, [0, -0.28, 0])}
            </group>
          </group>
        ))}
      </group>
      {[1, -1].map((side, i) => {
        const l = pose.legs[i];
        return (
          <group key={side} position={[side * -HIP_W, 0, 0]} rotation={[-l.hip, 0, 0]}>
            {P(g.thigh, [0, -THIGH / 2, 0])}
            <group position={[0, -THIGH, 0]} rotation={[l.knee, 0, 0]}>
              {P(g.shin, [0, -SHIN / 2, 0])}
              <group position={[0, -SHIN, 0]} rotation={[l.ankle, 0, 0]}>
                {P(g.foot, [0, -0.038, 0.05], [Math.PI / 2, 0, 0])}
              </group>
            </group>
          </group>
        );
      })}
    </group>
  );
};
