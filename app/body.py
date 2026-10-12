"""Body composition from weight and impedance.

Open formulas used by openScale (MiScaleLib) and by the body_metrics module of the
wiecosystem project, which reproduce the numbers of Xiaomi's app (Zepp Life).
They are bioimpedance estimates: good for trends, not exact or medical measurements.
"""

from datetime import date


def age_on(birth: date, day: date) -> int:
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def compute(weight: float, impedance: int | None, height_cm: float, birth: date,
            male: bool, day: date | None = None) -> dict:
    day = day or date.today()
    age = age_on(birth, day)
    h = height_cm
    sex = 1 if male else 0
    out = {"bmi": round(weight / (h / 100) ** 2, 1), "age": age}

    if male:
        bmr = 877.8 + weight * 14.916 - h * 0.726 - age * 8.976
        bmr = 5000 if bmr > 2322 else bmr
    else:
        bmr = 864.6 + weight * 10.2036 - h * 0.39336 - age * 6.204
        bmr = 5000 if bmr > 2996 else bmr
    out["bmr"] = round(min(max(bmr, 500), 10000))

    if sex == 0:
        if weight > (13 - h * 0.5) * -1:
            sub = (h * 1.45 + h * 0.1158 * h) - 120
            visceral = (weight * 500 / sub - 6) + age * 0.07
        else:
            sub = 0.691 + h * -0.0024 + h * -0.0024
            visceral = ((h * 0.027 - sub * weight) * -1) + age * 0.07 - age
    else:
        if h < weight * 1.6:
            sub = ((h * 0.4) - (h * (h * 0.0826))) * -1
            visceral = (weight * 305) / (sub + 48) - 2.9 + age * 0.15
        else:
            sub = 0.765 + h * -0.0015
            visceral = ((h * 0.143 - weight * sub) * -1) + age * 0.15 - 5
    out["visceral_fat"] = round(min(max(visceral, 1), 50), 1)

    if not impedance:
        return out

    lbm_coeff = (h * 9.058 / 100) * (h / 100) + weight * 0.32 + 12.226 - impedance * 0.0068 - age * 0.0542

    lbm_sub = 0.8
    if sex == 0:
        lbm_sub = 9.25 if age <= 49 else 7.25
    coeff = 1.0
    if sex == 1 and weight < 61:
        coeff = 0.98
    elif sex == 0 and weight > 60:
        coeff = 0.96 * (1.03 if h > 160 else 1)
    elif sex == 0 and weight < 50:
        coeff = 1.02 * (1.03 if h > 160 else 1)
    fat = (1 - ((lbm_coeff - lbm_sub) * coeff) / weight) * 100
    if fat > 63:
        fat = 75
    fat = min(max(fat, 5), 75)

    base = 0.245691014 if sex == 0 else 0.18016894
    bone = (base - lbm_coeff * 0.05158) * -1
    bone = bone + 0.1 if bone > 2.2 else bone - 0.1
    if (sex == 0 and bone > 5.1) or (sex == 1 and bone > 5.2):
        bone = 8
    bone = min(max(bone, 0.5), 8)

    muscle = weight - fat * 0.01 * weight - bone
    if (sex == 0 and muscle >= 84) or (sex == 1 and muscle >= 93.5):
        muscle = 120

    water = (100 - fat) * 0.7
    water *= 1.02 if water < 50 else 0.98

    protein = muscle / weight * 100 - water

    out.update({
        "body_fat": round(fat, 1),
        "fat_mass": round(weight * fat / 100, 2),
        "muscle_mass": round(muscle, 2),
        "bone_mass": round(bone, 2),
        "water": round(water, 1),
        "protein": round(protein, 1),
        "lean_mass": round(weight - weight * fat / 100, 2),
    })
    return out
