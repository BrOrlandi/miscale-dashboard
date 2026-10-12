"""Builds scale advertisements the way the Mi Body Composition Scale 2 sends them."""


def packet(weight_kg: float, impedance: int | None = None, stabilized: bool = False, removed: bool = False,
           lbs: bool = False, when=(2026, 10, 12, 7, 30, 0), impedance_raw: int | None = None) -> bytes:
    c0 = 0x02 | (0x01 if lbs else 0)
    c1 = 0x04
    if impedance is not None or impedance_raw is not None:
        c1 |= 0x02
    if stabilized:
        c1 |= 0x20
    if removed:
        c1 |= 0x80
    year, month, day, hour, minute, second = when
    imp = impedance_raw if impedance_raw is not None else (impedance or 0)
    raw_weight = round(weight_kg / 0.45359237 * 100) if lbs else round(weight_kg * 200)
    return (bytes([c0, c1]) + year.to_bytes(2, "little") + bytes([month, day, hour, minute, second])
            + imp.to_bytes(2, "little") + raw_weight.to_bytes(2, "little"))
