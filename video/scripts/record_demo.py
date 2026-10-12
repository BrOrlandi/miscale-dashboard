"""Records the live demo frame by frame, for the promo video's "projected screen" shots.

    uv run --with playwright python video/scripts/record_demo.py [--cdp URL] [--url URL]

Without --cdp it launches a local Chromium (run `uv run --with playwright playwright install
chromium` once). With --cdp it drives an existing Chromium over the DevTools protocol.

The page runs on a virtual clock instead of real time: timers, Date, performance.now,
requestAnimationFrame and CSS animations only move when the recorder steps them, one frame at
a time, and a screenshot is taken after every step. That makes the clips perfectly smooth at
the video's frame rate no matter how slow the browser or the network is.

Writes, at 2560x1440 (a 1280x720 page at 2x), 30 fps, H.264:
  public/footage/weighin.mp4    Play demo: weight settling, result, dashboard update, AI analysis
  public/footage/chart.mp4      the weight chart drawn in for 30 days, 90 days and all time
Needs ffmpeg on the PATH.
"""

import argparse
import asyncio
import base64
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright

DEMO = "https://brorlandi.github.io/miscale-dashboard/"
OUT = Path(__file__).resolve().parent.parent / "public" / "footage"
FPS = 30
TICKS = 2   # animation frames per video frame: the page runs at 60 Hz, like a real display
VIEW = {"width": 1280, "height": 720}
SCALE = 2

# Installed before any page script. Until __vt.manual() the clock follows real time; after it,
# time only moves through __vt.step(ms).
CLOCK = r"""
(() => {
  try { localStorage.setItem("lang", "en"); localStorage.setItem("theme", "light"); } catch {}
  const O = { setTimeout: setTimeout.bind(window), perf: performance.now.bind(performance) };
  const RealDate = Date;
  let now = O.perf(), manual = false, nextId = 1;
  const offset = RealDate.now() - now;
  const timers = new Map(), frames = new Map();
  const add = (fn, delay, args, repeat) => {
    const id = nextId++;
    delay = Math.max(0, +delay || 0);
    timers.set(id, { fn, args, at: now + delay, every: repeat ? Math.max(1, delay) : 0 });
    return id;
  };
  window.setTimeout = (fn, delay, ...args) => add(fn, delay, args, false);
  window.setInterval = (fn, delay, ...args) => add(fn, delay, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (fn) => { const id = nextId++; frames.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  performance.now = () => now;
  function VDate(...a) {
    if (!new.target) return new RealDate(offset + now).toString();
    return a.length ? new RealDate(...a) : new RealDate(offset + now);
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => Math.round(offset + now);
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  window.Date = VDate;

  const run = (fn, args) => {
    try { typeof fn === "function" ? fn(...args) : (0, eval)(fn); } catch (e) { console.error(e); }
  };
  function advance(to) {
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= to && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      run(t.fn, t.args);
    }
    now = to;
    const due = [...frames.values()];
    frames.clear();
    for (const fn of due) run(fn, [now]);
  }
  function animations(dt) {
    for (const a of document.getAnimations()) {
      if (!a.__vt) { a.__vt = true; a.pause(); a.currentTime = a.currentTime || 0; continue; }
      if (a.currentTime != null) a.currentTime += dt;
    }
  }
  (function realTime() {
    if (manual) return;
    advance(O.perf());
    O.setTimeout(realTime, 8);
  })();
  // scrollIntoView({behavior: "smooth"}) scrolls in real time; ease it on the virtual clock.
  Element.prototype.scrollIntoView = function (opts) {
    const y0 = scrollY, top = this.getBoundingClientRect().top + scrollY - 12;
    const y1 = Math.max(0, Math.min(top, document.documentElement.scrollHeight - innerHeight));
    if (!opts || opts.behavior !== "smooth") return scrollTo(0, y1);
    const t0 = now, ms = 700;
    requestAnimationFrame(function f() {
      const k = Math.min(1, (now - t0) / ms);
      scrollTo(0, y0 + (y1 - y0) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(f);
    });
  };
  window.__vt = {
    manual() { manual = true; animations(0); },
    step(ms) { advance(now + ms); animations(ms); },
  };
})();
"""


class Clip:
    """Steps the page's clock and pipes a screenshot per frame into ffmpeg."""

    def __init__(self, page, cdp, path: Path):
        self.page, self.cdp, self.path, self.frames = page, cdp, path, 0
        path.parent.mkdir(parents=True, exist_ok=True)
        self.ffmpeg = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
             "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             str(path)],
            stdin=subprocess.PIPE)

    async def shoot(self, seconds: float):
        for _ in range(round(seconds * FPS)):
            for _ in range(TICKS):
                await self.page.evaluate(f"__vt.step({1000 / FPS / TICKS})")
            shot = await self.cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 95})
            self.ffmpeg.stdin.write(base64.b64decode(shot["data"]))
            self.frames += 1

    def close(self):
        self.ffmpeg.stdin.close()
        self.ffmpeg.wait()
        print(f"{self.path.name}: {self.frames} frames, {self.frames / FPS:.1f} s")


async def open_demo(browser, url):
    ctx = await browser.new_context(viewport=VIEW, device_scale_factor=SCALE, locale="en-US", color_scheme="light",
                                    reduced_motion="no-preference")
    await ctx.add_init_script(CLOCK)
    page = await ctx.new_page()
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_timeout(1500)
    await page.evaluate("__vt.manual()")
    return ctx, page, await ctx.new_cdp_session(page)


async def record(browser, url: str, only: str | None = None):
    if only in (None, "weighin"):
        await weighin(browser, url)
    if only in (None, "chart"):
        await chart(browser, url)


async def weighin(browser, url: str):
    # 1. A weigh-in from Play demo to the end of the weekly analysis.
    ctx, page, cdp = await open_demo(browser, url)
    # Math.random picks how much lighter Alex is today: 0 is the most (81.35 kg on the demo data).
    await page.evaluate("Math.random = () => 0")
    clip = Clip(page, cdp, OUT / "weighin.mp4")
    await clip.shoot(0.6)
    await page.click("#demoPlay")
    await clip.shoot(21.5)   # settling, stable, body composition, stepped off, screen closes
    for _ in range(80):      # until the analysis has been typed in full
        await clip.shoot(0.5)
        if await page.evaluate("typeof typing === 'undefined' || !typing") and clip.frames > 25 * FPS:
            break
    await clip.shoot(1.5)
    clip.close()
    await ctx.close()


async def chart(browser, url: str):
    # 2. The weight chart, drawn in for longer and longer ranges.
    ctx, page, cdp = await open_demo(browser, url)
    await page.evaluate("document.getElementById('chart').closest('section').scrollIntoView()")
    await page.evaluate("scrollBy(0, -40)")
    clip = Clip(page, cdp, OUT / "chart.mp4")
    # The range buttons redraw without animation: replay Chart.js's draw-in after each one.
    for days in (30, 90, 0):
        await page.click(f'#range button[data-days="{days}"]')
        await page.evaluate("chart.options.animation = { duration: 1500, easing: 'easeOutQuart' }; chart.reset();"
                            "chart.update()")
        await clip.shoot(2.2)
    clip.close()
    await ctx.close()


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cdp", help="DevTools URL of a running Chromium (default: launch a local one)")
    ap.add_argument("--url", default=DEMO)
    ap.add_argument("--only", choices=["weighin", "chart"], help="record just one of the clips")
    args = ap.parse_args()
    async with async_playwright() as p:
        browser = await (p.chromium.connect_over_cdp(args.cdp) if args.cdp else p.chromium.launch())
        try:
            await record(browser, args.url, args.only)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
