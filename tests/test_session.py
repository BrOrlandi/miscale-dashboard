from datetime import datetime, timedelta

from app.db import DB
from app.scale import parse
from app.session import Session, guess_profile

from .packets import packet


class Clock:
    def __init__(self):
        self.t = datetime(2026, 10, 12, 7, 30)

    def __call__(self):
        return self.t


def reading(weight, **kw):
    r = parse(packet(weight, **kw))
    r.address = "AA:BB:CC:DD:EE:FF"
    return r


def setup():
    db = DB(":memory:")
    a = db.save_profile({"name": "Alex", "height_cm": 178, "birth": "1990-01-01", "male": True, "ref_weight": 82})
    s = db.save_profile({"name": "Sam", "height_cm": 165, "birth": "1993-01-01", "male": False, "ref_weight": 61})
    clock = Clock()
    return db, Session(db, now=clock), clock, a, s


def test_full_weigh_in_becomes_one_measurement():
    db, session, clock, alex, _ = setup()
    assert session.handle(reading(81.5)) is None                         # still settling
    saved = session.handle(reading(81.6, stabilized=True))
    assert saved["event"] == "saved"
    assert saved["measurement"]["profile_id"] == alex
    assert "body_fat" not in saved["measurement"]["metrics"]
    clock.t += timedelta(seconds=3)
    updated = session.handle(reading(81.6, impedance=480, stabilized=True))
    assert updated["event"] == "updated"
    assert updated["measurement"]["impedance"] == 480
    assert "body_fat" in updated["measurement"]["metrics"]
    clock.t += timedelta(seconds=5)
    assert session.handle(reading(81.6, impedance=480, stabilized=True, removed=True)) is None
    assert len(db.list()) == 1


def test_old_result_after_restart_is_ignored():
    db, session, *_ = setup()
    assert session.handle(reading(81.6, impedance=480, stabilized=True, removed=True)) is None
    assert db.list() == []


def test_profile_by_closest_weight_and_unknown():
    db, session, clock, alex, sam = setup()
    assert session.handle(reading(60.2, stabilized=True))["measurement"]["profile_id"] == sam
    clock.t += timedelta(minutes=5)
    assert session.handle(reading(120, stabilized=True))["measurement"]["profile_id"] is None
    assert guess_profile(db, 83) == alex


def test_single_profile_without_history_takes_first_weigh_in():
    db = DB(":memory:")
    pid = db.save_profile({"name": "Solo", "male": True})
    assert guess_profile(db, 95) == pid
