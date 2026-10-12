import itertools
import json
import re
import shutil
import sqlite3
import subprocess
from datetime import date
from pathlib import Path

import pytest

from app.body import compute
from scripts import build_demo, seed_demo

ROOT = Path(__file__).resolve().parent.parent


def test_build_demo(tmp_path):
    site = build_demo.build(tmp_path / "site")
    html = (site / "index.html").read_text()
    # The demo scripts load before the main script, which still comes from app/static/index.html.
    assert html.index('src="demo/body.js"') < html.index('src="demo/demo.js"') < html.index("const STRINGS")
    # Nothing absolute that would miss the /miscale-dashboard/ base path on GitHub Pages...
    assert not re.search(r'(src|href)="/', html)
    # ...and every /api call left is a fetch(), which demo.js answers from memory.
    for line in (line for line in html.splitlines() if "/api/" in line):
        assert re.search(r'fetch\(.*[`"]/api/', line), line
    assert "demoPhotoUrl(p)" in html
    # The page asks for the weekly analysis; the demo answers it and simulates its stream.
    demo_js = (site / "demo" / "demo.js").read_text()
    assert "/api/analyses/run" in html and '"analyses/run"' in demo_js and "analysis_delta" in demo_js
    for path in ("demo/demo.js", "demo/body.js", "demo/alex.jpg", "static/vendor/chart.umd.min.js",
                 "static/icons/icon-192.png"):
        assert (site / path).is_file(), path
    # No service worker in the demo, and the manifest works under any base path.
    assert not (site / "sw.js").exists() and not (site / "static" / "sw.js").exists()
    manifest = json.loads((site / "manifest.webmanifest").read_text())
    assert manifest["start_url"] == manifest["scope"] == "./"
    assert all(not i["src"].startswith("/") and (site / i["src"]).is_file() for i in manifest["icons"])


def test_build_demo_stops_when_index_changes():
    with pytest.raises(SystemExit):
        build_demo.demo_html("<html></html>")


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_body_js_matches_body_py():
    cases = [(w, imp, h, birth, male, "2026-10-12")
             for w, imp, h, birth, male in itertools.product(
                 (45.2, 58.7, 64.8, 81.4, 112.3), (None, 420, 478, 590), (152, 166, 178, 191),
                 ("1958-03-01", "1991-04-13", "2004-11-30"), (True, False))]
    script = ("const B = require(process.argv[1]); const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
              "console.log(JSON.stringify(cases.map((c) => B.compute(...c))));")
    out = subprocess.run(["node", "-e", script, str(ROOT / "demo" / "body.js")], input=json.dumps(cases),
                         capture_output=True, text=True, check=True).stdout
    for case, js in zip(cases, json.loads(out), strict=True):
        w, imp, h, birth, male, day = case
        py = compute(w, imp, h, date.fromisoformat(birth), male, date.fromisoformat(day))
        assert js.keys() == py.keys(), case
        for k in py:
            assert js[k] == pytest.approx(py[k], abs=0.011 if isinstance(py[k], float) else 1), (case, k)


def test_seed_demo_gives_alex_the_photo(tmp_path):
    seed_demo.main(str(tmp_path / "demo.db"))
    rows = dict(sqlite3.connect(tmp_path / "demo.db").execute("SELECT name, photo FROM profiles").fetchall())
    assert re.fullmatch(r"1\.jpg\?v=\d+", rows["Alex"]) and rows["Sam"] is None
    assert (tmp_path / "photos" / "1.jpg").read_bytes() == (ROOT / "docs" / "demo" / "alex.jpg").read_bytes()
