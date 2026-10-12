from app import notify


def test_message_kg_and_lb():
    m = {"measured_at": "2026-10-12T07:30:00", "weight_kg": 80.0, "impedance": 500,
         "metrics": {"body_fat": 20.0, "fat_mass": 16.0, "muscle_mass": 60.0, "water": 55.0, "protein": 18.0,
                     "bone_mass": 3.0, "bmi": 25.2, "visceral_fat": 9, "bmr": 1700}}
    prev = {"measured_at": "2026-10-11T07:30:00", "weight_kg": 80.5}
    profile = {"name": "Alex", "height_cm": 178, "birth": "1990-01-01"}
    text = notify.message(m, profile, [prev], "kg", "en")
    assert text.startswith("⚖️ Alex · 80.00 kg")
    assert "−0.50 kg since" in text and "Impedance 500 Ω" in text
    assert "176.37 lb" in notify.message(m, profile, [], "lb", "en")
    assert "80,00 kg" in notify.message(m, profile, [], "kg", "pt-BR")


def test_unknown_person():
    m = {"measured_at": "2026-10-12T07:30:00", "weight_kg": 80.0, "metrics": {}}
    assert "doesn't match any profile" in notify.message(m, None, [], "kg", "en")
