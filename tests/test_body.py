from datetime import date
from app.body import age_on, compute


def test_age_calculation():
    assert age_on(date(1990, 5, 10), date(2026, 5, 9)) == 35
    assert age_on(date(1990, 5, 10), date(2026, 5, 10)) == 36


def test_compute_without_impedance():
    res = compute(75.0, None, 175.0, date(1990, 1, 1), male=True, day=date(2026, 1, 1))
    assert res["bmi"] == 24.5
    assert res["age"] == 36
    assert "bmr" in res
    assert "visceral_fat" in res
    assert "body_fat" not in res


def test_compute_with_impedance():
    res = compute(75.0, 500, 175.0, date(1990, 1, 1), male=True, day=date(2026, 1, 1))
    assert res["bmi"] == 24.5
    assert 5.0 <= res["body_fat"] <= 50.0
    assert res["water"] > 0
    assert res["muscle_mass"] > 0
    assert res["bone_mass"] > 0
    assert res["fat_mass"] > 0
    assert res["lean_mass"] > 0
