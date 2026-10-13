from datetime import datetime
from app.db import DB
from app.scale import Reading
from app.session import Session, guess_profile


def test_session_handling_and_profile_matching():
    db = DB(":memory:")
    pid1 = db.save_profile({"name": "Alice", "height_cm": 165, "birth": "1995-03-20", "male": False, "ref_weight": 60.0})
    pid2 = db.save_profile({"name": "Bob", "height_cm": 180, "birth": "1990-07-15", "male": True, "ref_weight": 80.0})

    # Weight 79.5 should match Bob
    guessed = guess_profile(db, 79.5, tolerance_kg=5.0)
    assert guessed == pid2

    session = Session(db, tolerance=lambda: 5.0)

    # 1. Stabilized measurement without impedance
    r1 = Reading(
        address="AA:BB:CC:DD:EE:FF", rssi=-65, raw="aabb", weight_kg=79.5,
        impedance=None, body_fat=None, stabilized=True, removed=False,
        scale_time=datetime.now().isoformat()
    )
    res1 = session.handle(r1)
    assert res1 is not None
    assert res1["event"] == "saved"
    mid = res1["measurement"]["id"]
    assert res1["measurement"]["profile_id"] == pid2

    # 2. Few seconds later, same weigh-in arrives with impedance
    r2 = Reading(
        address="AA:BB:CC:DD:EE:FF", rssi=-65, raw="aabbcc", weight_kg=79.5,
        impedance=480, body_fat=None, stabilized=True, removed=False,
        scale_time=datetime.now().isoformat()
    )
    res2 = session.handle(r2)
    assert res2 is not None
    assert res2["event"] == "updated"
    assert res2["measurement"]["id"] == mid
    assert res2["measurement"]["impedance"] == 480
    assert "body_fat" in res2["measurement"]["metrics"]
