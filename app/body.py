"""Body composition from weight and impedance for Yunmai smart scales.

Implements the bioimpedance formulas used by Yunmai (YunmaiLib in openScale and
reverse-engineered from the official Yunmai APK).
"""

from __future__ import annotations

import math
from datetime import date


def age_on(birth: date, day: date) -> int:
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def compute(weight: float, impedance: int | None, height_cm: float, birth: date,
            male: bool, day: date | None = None, body_fat: float | None = None) -> dict:
    day = day or date.today()
    age = age_on(birth, day)
    h = height_cm
    h_m = h / 100.0

    out = {
        "bmi": round(weight / (h_m ** 2), 1),
        "age": age,
    }

    # BMR formula
    if male:
        bmr = 877.8 + weight * 14.916 - h * 0.726 - age * 8.976
    else:
        bmr = 864.6 + weight * 10.2036 - h * 0.39336 - age * 6.204
    out["bmr"] = round(min(max(bmr, 500), 10000))

    # Visceral fat default if no impedance
    if not impedance and body_fat is None:
        if male:
            sub = ((h * 0.4) - (h * (h * 0.0826))) * -1
            vf = (weight * 305) / (sub + 48) - 2.9 + age * 0.15
        else:
            sub = (h * 1.45 + h * 0.1158 * h) - 120
            vf = (weight * 500 / sub - 6) + age * 0.07
        out["visceral_fat"] = round(min(max(vf, 1.0), 50.0), 1)
        return out

    # Body fat calculation (Yunmai algorithm)
    if body_fat is not None and 5.0 <= body_fat <= 75.0:
        fat = body_fat
    elif impedance and impedance > 0:
        r = (impedance - 100.0) / 100.0
        if r >= 1.0:
            r = math.sqrt(r)
        fat = (weight * 1.5 / (h_m * h_m)) + (age * 0.08)
        if male:
            fat -= 10.8
        fat = (fat - 7.4) + r
        fat = min(max(fat, 5.0), 75.0)
    else:
        return out

    # Water percentage
    water = (100.0 - fat) * 0.726

    # Muscle percentage and mass
    muscle_pct = (100.0 - fat) * 0.67
    muscle_mass = weight * (muscle_pct / 100.0)

    # Bone mass (kg)
    h_diff = h - 170.0
    if male:
        bone = ((weight * (muscle_pct / 100.0) * 4.0) / 7.0 * 0.22 * 0.6) + (h_diff / 100.0)
    else:
        bone = ((weight * (muscle_pct / 100.0) * 4.0) / 7.0 * 0.34 * 0.45) + (h_diff / 100.0)
    bone = min(max(bone, 0.5), 8.0)

    # Visceral fat index (Yunmai formula)
    a = min(max(age, 18), 120)
    if male:
        f_offset = 21.0 if a < 40 else (22.0 if a < 60 else 24.0)
        f_val = fat - f_offset
        d = 1.1 if f_val > 0 else 1.4
    else:
        f_offset = 34.0 if a < 40 else (35.0 if a < 60 else 36.0)
        f_val = fat - f_offset
        d = 1.1 if f_val > 0 else 1.8
    vf = (f_val / d) + 9.5
    visceral = min(max(vf, 1.0), 30.0)

    # Protein percentage
    protein = max(muscle_pct - water, 5.0)

    # Lean mass
    lean_mass = weight * (100.0 - fat) / 100.0
    fat_mass = weight * fat / 100.0

    out.update({
        "body_fat": round(fat, 1),
        "fat_mass": round(fat_mass, 2),
        "muscle_mass": round(muscle_mass, 2),
        "bone_mass": round(bone, 2),
        "water": round(water, 1),
        "protein": round(protein, 1),
        "visceral_fat": round(visceral, 1),
        "lean_mass": round(lean_mass, 2),
    })
    return out
