// Renders single frames as PNGs, for reviewing scenes without rendering the whole video.
//
//     node scripts/stills.mjs [--vertical] [--scale 0.5] [--out out/stills] 96 204 600 ...
//
// Frames are 30 fps frame numbers (src/timeline.json: one beat is 12 frames).

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const vertical = args.includes("--vertical") && args.splice(args.indexOf("--vertical"), 1);
const scale = Number(opt("--scale", "1"));
const out = opt("--out", "out/stills");
const id = vertical ? "PromoVertical" : "Promo";
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id, chromiumOptions: { gl: "angle" } });
for (const frame of args.map(Number)) {
  const output = path.join(out, `${id}-${String(frame).padStart(4, "0")}.png`);
  await renderStill({ serveUrl, composition, frame, output, scale, chromiumOptions: { gl: "angle" } });
  console.log(output);
}
