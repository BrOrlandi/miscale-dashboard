"""Creates a demo database with two fictional people and ~90 days of weigh-ins.

    python -m scripts.seed_demo data/demo.db
    MISCALE_DB=data/demo.db MISCALE_SCANNER=off uvicorn app.main:app --port 8800

Then play a fake weigh-in: curl -X POST 'localhost:8800/api/debug/simulate?weight=81.4&impedance=478'

Alex gets the made-up photo in docs/demo/alex.jpg (see docs/demo/README.md); Sam keeps the initials.
"""

import random
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.db import DB  # noqa: E402
from app.session import metrics_for  # noqa: E402

PEOPLE = [
    # name, height, birth, male, start weight, end weight, impedance start, end, photo
    ("Alex", 178, "1991-04-13", True, 86.4, 81.6, 520, 478, ROOT / "docs" / "demo" / "alex.jpg"),
    ("Sam", 166, "1994-09-02", False, 64.8, 62.1, 590, 560, None),
]


def main(path: str):
    if Path(path).exists():
        Path(path).unlink()
    db = DB(path)
    rng = random.Random(7)
    now = datetime.now().replace(second=0, microsecond=0)
    days = 90
    photos = Path(path).parent / "photos"   # where the app keeps uploaded photos (app.main.PHOTOS)
    for name, height, birth, male, w0, w1, i0, i1, photo in PEOPLE:
        pid = db.save_profile({"name": name, "height_cm": height, "birth": birth, "male": male, "ref_weight": w0})
        for old in photos.glob(f"{pid}.*"):
            old.unlink()
        if photo:
            photos.mkdir(parents=True, exist_ok=True)
            shutil.copy(photo, photos / f"{pid}.jpg")
            db.set_photo(pid, f"{pid}.jpg?v={int(datetime.now().timestamp())}")
        for d in range(days, 0, -1):
            if rng.random() < 0.18:   # skipped days
                continue
            k = 1 - d / days
            when = (now - timedelta(days=d)).replace(hour=7, minute=rng.randint(0, 50))
            weight = round(w0 + (w1 - w0) * k + rng.gauss(0, 0.35), 2)
            imp = int(i0 + (i1 - i0) * k + rng.gauss(0, 12))
            iso = when.isoformat(timespec="seconds")
            db.insert({"measured_at": iso, "weight_kg": weight, "impedance": imp, "profile_id": pid,
                       "metrics": metrics_for(db, pid, weight, imp, iso), "address": "DEMO"})
    print(f"demo database written to {path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/demo.db")
