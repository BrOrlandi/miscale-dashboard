"""Turns the stream of scale packets into saved measurements and picks whose they are."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from . import body
from .db import DB
from .scale import Reading

log = logging.getLogger("yunmai.session")

DEFAULT_TOLERANCE_KG = 5.0


def metrics_for(db: DB, profile_id: int | None, weight: float, impedance: int | None,
                when: str, body_fat: float | None = None) -> dict:
    p = db.profile(profile_id) if profile_id else None
    if not p or not p.get("height_cm") or not p.get("birth"):
        return {}
    return body.compute(weight, impedance, float(p["height_cm"]), date.fromisoformat(p["birth"]),
                        p["male"], datetime.fromisoformat(when).date(), body_fat=body_fat)


def guess_profile(db: DB, weight: float, tolerance_kg: float = DEFAULT_TOLERANCE_KG) -> int | None:
    """The profile whose last weight (or reference weight) is closest, within the tolerance."""
    profiles = db.profiles()
    best, best_diff = None, None
    for p in profiles:
        last = db.last(p["id"])
        ref = last["weight_kg"] if last else p.get("ref_weight")
        if ref is None:
            continue
        diff = abs(ref - weight)
        if diff <= tolerance_kg and (best_diff is None or diff < best_diff):
            best, best_diff = p["id"], diff
    # If there is only a single profile, every weigh-in belongs to it.
    if best is None and len(profiles) == 1:
        best = profiles[0]["id"]
    return best


class Session:
    """Groups the packets of one weigh-in into a single measurement.

    The scale sends the weight while it settles, then the stabilized weight and
    impedance. Deduplicated by weight and arrival time.
    """

    WINDOW = timedelta(minutes=3)

    def __init__(self, db: DB, tolerance=lambda: DEFAULT_TOLERANCE_KG, now=datetime.now):
        self.db = db
        self.tolerance = tolerance
        self.now = now

    def handle(self, r: Reading) -> dict | None:
        """Returns {"event": "saved"|"updated", "measurement": ...} or None."""
        if not r.stabilized:
            return None
        now = self.now()
        recent = self.db.list(limit=1)
        m = recent[0] if recent else None
        if (m and m["address"] == r.address and abs(m["weight_kg"] - r.weight_kg) <= 0.1
                and now - datetime.fromisoformat(m["measured_at"]) < self.WINDOW):
            if r.impedance and not m["impedance"]:
                metrics = metrics_for(self.db, m["profile_id"], m["weight_kg"], r.impedance,
                                      m["measured_at"], body_fat=r.body_fat)
                self.db.update(m["id"], impedance=r.impedance, raw=r.raw, metrics=metrics)
                log.info("measurement %s: impedance %s", m["id"], r.impedance)
                return {"event": "updated", "measurement": self.db.get(m["id"])}
            return None
        if r.removed:
            # An old result being repeated
            return None
        pid = guess_profile(self.db, r.weight_kg, self.tolerance())
        when = now.isoformat(timespec="seconds")
        metrics = metrics_for(self.db, pid, r.weight_kg, r.impedance, when, body_fat=r.body_fat)
        mid = self.db.insert({
            "measured_at": when, "scale_time": r.scale_time, "weight_kg": r.weight_kg,
            "impedance": r.impedance, "profile_id": pid, "raw": r.raw, "address": r.address,
            "metrics": metrics,
        })
        log.info("measurement %s: %.2f kg, impedance %s, profile %s", mid, r.weight_kg, r.impedance, pid)
        return {"event": "saved", "measurement": self.db.get(mid)}
