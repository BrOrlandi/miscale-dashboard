# Promo video

The source of the Mi Scale Dashboard promo video: a ~41 second, text-only, music-driven clip
built with code, so anyone can change it and render it again.

- `out/miscale-dashboard.mp4`: 1920x1080, 30 fps, H.264 + AAC
- `out/miscale-dashboard-vertical.mp4`: 1080x1920 for Reels, Shorts and TikTok

The rendered landscape video is also committed at
[`docs/video/miscale-dashboard.mp4`](../docs/video/miscale-dashboard.mp4).

## Render

Needs Node.js 20 or newer (Remotion brings its own ffmpeg).

```bash
cd video
npm ci
npm run render
```

`npm run render` writes the soundtrack (`scripts/make_music.mjs`) and then renders both
cuts into `out/`. It takes a few minutes; the 3D scenes render with WebGL through ANGLE
(`remotion.config.ts`). `npm run docs` then refreshes the smaller copy (CRF 23, ~12 MB) and the
poster frame in `docs/video/` that the main README links to.

Other commands:

```bash
npm run studio                                   # preview and scrub in the browser
node scripts/stills.mjs --scale 0.5 96 204 600   # single frames as PNGs in out/stills
node scripts/stills.mjs --vertical 1100          # the same for the vertical cut
```

## How it is put together

Everything follows one beat grid: 150 BPM at 30 fps, so a beat is exactly 12 frames.
[`src/timeline.json`](src/timeline.json) lists the scenes and the sound cues in beats, and both
the video (`src/Promo.tsx`) and the soundtrack (`scripts/make_music.mjs`) read it, so every cut
lands on a hit.

| Beats | Scene | File |
| --- | --- | --- |
| 0–24 | 3D: a person, drawn only as a silhouette outline, walks in and steps on a glass scale; the display counts up and locks the weight; body composition pops up | `src/scenes/ScaleScene.tsx`, `src/three/` |
| 24–32 | The live weigh-in screen, recorded from the demo, on a screen floating in 3D | `src/scenes/ScreenScenes.tsx` |
| 32–40 | The 90-day chart drawn in as motion graphics, then the recorded chart | `src/scenes/ScreenScenes.tsx`, `src/components/Chart.tsx` |
| 40–48 | The dashboard updating after the weigh-in, with metric cards around it | `src/scenes/ScreenScenes.tsx` |
| 48–64 | AI coach: the weekly analysis typed in, next to the recorded dashboard typing its own | `src/scenes/AiScene.tsx` |
| 64–80 | A generic phone and chat app: the weigh-in message, then the weekly AI analysis | `src/scenes/PhoneScene.tsx` |
| 80–88 | Free. Open source. | `src/scenes/EndScenes.tsx` |
| 88–102 | Logo, repository and live demo links | `src/scenes/EndScenes.tsx` |

The silhouette is a jointed figure of capsules, posed with two-bone IK for the legs, and drawn
through the stencil buffer so only one clean contour around the whole body shows
(`src/three/Mannequin.tsx`).

## Recording the demo footage

The clips in `public/footage/` are recordings of the [live demo](https://brorlandi.github.io/miscale-dashboard/)
at 2560x1440 (a 1280x720 page at 2x), made with:

```bash
uv run --with playwright python video/scripts/record_demo.py              # local Chromium
uv run --with playwright python video/scripts/record_demo.py --cdp URL    # an existing Chromium
```

The script runs the page on a virtual clock (timers, `Date`, `requestAnimationFrame` and CSS
animations only move when it steps them) and takes a screenshot per frame, so the clips are
smooth at exactly 30 fps however slow the browser is. Run it again after the dashboard changes,
and check the clip times noted at the top of `src/scenes/ScreenScenes.tsx`.

## Assets and licenses

| Asset | Source | License |
| --- | --- | --- |
| Music and sound effects (`public/audio/soundtrack.wav`, generated) | Synthesized from oscillators and seeded noise by [`scripts/make_music.mjs`](scripts/make_music.mjs): an original 150 BPM phonk/trap beat (808, claps, hats, cowbell melody, pads) plus impacts, whooshes, risers, the scale's ticks and the phone pings. No samples or third-party audio. | MIT, with this repository |
| Demo footage (`public/footage/*.mp4`) | Recorded from the live demo by `scripts/record_demo.py`. All data is made up (`demo/demo.js`); Alex's photo is AI-generated, not a real person ([docs/demo](../docs/demo/README.md)). | MIT, with this repository |
| Logo | Redrawn as SVG from `scripts/make_icons.py` | MIT, with this repository |
| Fonts: [Anton](https://fonts.google.com/specimen/Anton), [Inter](https://fonts.google.com/specimen/Inter) | Google Fonts, loaded at render time by `@remotion/google-fonts` | SIL Open Font License 1.1 |
| Phone and chat app | Drawn in CSS: a generic phone frame and a generic chat app, no real brand | MIT, with this repository |
| [Remotion](https://www.remotion.dev) | npm | [Remotion License](https://www.remotion.dev/license): free for individuals and companies of up to 3 people; larger companies need a company license |
| [three.js](https://threejs.org), [React Three Fiber](https://github.com/pmndrs/react-three-fiber), React | npm | MIT |

Emoji in the phone messages are drawn by the emoji font of the machine that renders the video.
