"""Builds the live demo: the dashboard running entirely in the browser, with made-up data.

    python scripts/build_demo.py [site]
    python -m http.server -d site 8000      # then open http://localhost:8000/

The output is a static folder for GitHub Pages (.github/workflows/pages.yml). It is
app/static plus demo/body.js and demo/demo.js, an in-memory backend that answers the
dashboard's fetch("/api/...") calls and replaces its WebSocket. index.html is copied with a
few checked edits: relative paths (Pages serves the site under /miscale-dashboard/), the demo
scripts loaded before the main script, and profile photos read from the demo. The service
worker is left out. Only the standard library is used.
"""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"
CHART = '<script src="/static/vendor/chart.umd.min.js"></script>'
DEMO_SCRIPTS = '<script src="demo/body.js"></script>\n<script src="demo/demo.js"></script>'

# (original, replacement): each original must be in index.html, so a change there that the
# demo doesn't know about stops the build instead of shipping a broken page.
EDITS = [
    ("<title>Mi Scale Dashboard</title>", "<title>Mi Scale Dashboard · Demo</title>"),
    (CHART, CHART.replace('"/static/', '"static/') + "\n" + DEMO_SCRIPTS),
    ('href="/static/', 'href="static/'),
    ('href="/manifest.webmanifest"', 'href="manifest.webmanifest"'),
    ('`/api/profiles/${p.id}/photo?${p.photo.split("?")[1] || ""}`', "demoPhotoUrl(p)"),
]


def demo_html(html: str) -> str:
    for old, new in EDITS:
        if old not in html:
            raise SystemExit(f"build_demo: {old!r} not found in index.html; update scripts/build_demo.py")
        html = html.replace(old, new)
    return html


def demo_manifest(manifest: dict) -> dict:
    """Paths relative to the manifest, so the demo installs under any base path."""
    return {
        **manifest,
        "name": manifest["name"] + " (demo)",
        "id": "./", "start_url": "./", "scope": "./",
        "icons": [{**i, "src": i["src"].lstrip("/")} for i in manifest["icons"]],
        "screenshots": [{**s, "src": s["src"].lstrip("/")} for s in manifest.get("screenshots", [])],
    }


def build(out: Path) -> Path:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC, out / "static", ignore=shutil.ignore_patterns("index.html", "sw.js", "manifest.webmanifest"))
    (out / "demo").mkdir()
    for name in ("body.js", "demo.js"):
        shutil.copy(ROOT / "demo" / name, out / "demo" / name)
    shutil.copy(ROOT / "docs" / "demo" / "alex.jpg", out / "demo" / "alex.jpg")
    (out / "index.html").write_text(demo_html((STATIC / "index.html").read_text()))
    manifest = json.loads((STATIC / "manifest.webmanifest").read_text())
    (out / "manifest.webmanifest").write_text(json.dumps(demo_manifest(manifest), indent=2, ensure_ascii=False) + "\n")
    return out


if __name__ == "__main__":
    site = build(Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "site"))
    print(f"demo written to {site}")
