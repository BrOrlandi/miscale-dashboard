// Body composition from weight and impedance: a line-by-line port of app/body.py for the
// browser demo. tests/test_demo.py checks it against the Python version.
(function (root) {
  const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // Dates are "YYYY-MM-DD" strings, like the profile's birth field.
  function ageOn(birth, day) {
    const [by, bm, bd] = birth.split("-").map(Number);
    const [y, m, d] = day.split("-").map(Number);
    return y - by - ((m < bm || (m === bm && d < bd)) ? 1 : 0);
  }

  function compute(weight, impedance, heightCm, birth, male, day) {
    const age = ageOn(birth, day);
    const h = heightCm;
    const sex = male ? 1 : 0;
    const out = { bmi: round(weight / (h / 100) ** 2, 1), age };

    let bmr;
    if (male) {
      bmr = 877.8 + weight * 14.916 - h * 0.726 - age * 8.976;
      bmr = bmr > 2322 ? 5000 : bmr;
    } else {
      bmr = 864.6 + weight * 10.2036 - h * 0.39336 - age * 6.204;
      bmr = bmr > 2996 ? 5000 : bmr;
    }
    out.bmr = Math.round(clamp(bmr, 500, 10000));

    let sub, visceral;
    if (sex === 0) {
      if (weight > (13 - h * 0.5) * -1) {
        sub = (h * 1.45 + h * 0.1158 * h) - 120;
        visceral = (weight * 500 / sub - 6) + age * 0.07;
      } else {
        sub = 0.691 + h * -0.0024 + h * -0.0024;
        visceral = ((h * 0.027 - sub * weight) * -1) + age * 0.07 - age;
      }
    } else if (h < weight * 1.6) {
      sub = ((h * 0.4) - (h * (h * 0.0826))) * -1;
      visceral = (weight * 305) / (sub + 48) - 2.9 + age * 0.15;
    } else {
      sub = 0.765 + h * -0.0015;
      visceral = ((h * 0.143 - weight * sub) * -1) + age * 0.15 - 5;
    }
    out.visceral_fat = round(clamp(visceral, 1, 50), 1);

    if (!impedance) return out;

    const lbmCoeff = (h * 9.058 / 100) * (h / 100) + weight * 0.32 + 12.226 - impedance * 0.0068 - age * 0.0542;
    let lbmSub = 0.8;
    if (sex === 0) lbmSub = age <= 49 ? 9.25 : 7.25;
    let coeff = 1.0;
    if (sex === 1 && weight < 61) coeff = 0.98;
    else if (sex === 0 && weight > 60) coeff = 0.96 * (h > 160 ? 1.03 : 1);
    else if (sex === 0 && weight < 50) coeff = 1.02 * (h > 160 ? 1.03 : 1);
    let fat = (1 - ((lbmCoeff - lbmSub) * coeff) / weight) * 100;
    if (fat > 63) fat = 75;
    fat = clamp(fat, 5, 75);

    const base = sex === 0 ? 0.245691014 : 0.18016894;
    let bone = (base - lbmCoeff * 0.05158) * -1;
    bone = bone > 2.2 ? bone + 0.1 : bone - 0.1;
    if ((sex === 0 && bone > 5.1) || (sex === 1 && bone > 5.2)) bone = 8;
    bone = clamp(bone, 0.5, 8);

    let muscle = weight - fat * 0.01 * weight - bone;
    if ((sex === 0 && muscle >= 84) || (sex === 1 && muscle >= 93.5)) muscle = 120;

    let water = (100 - fat) * 0.7;
    water *= water < 50 ? 1.02 : 0.98;

    const protein = muscle / weight * 100 - water;

    Object.assign(out, {
      body_fat: round(fat, 1),
      fat_mass: round(weight * fat / 100, 2),
      muscle_mass: round(muscle, 2),
      bone_mass: round(bone, 2),
      water: round(water, 1),
      protein: round(protein, 1),
      lean_mass: round(weight - weight * fat / 100, 2),
    });
    return out;
  }

  root.MiscaleBody = { compute, ageOn };
  if (typeof module !== "undefined") module.exports = root.MiscaleBody;
})(typeof window !== "undefined" ? window : globalThis);
