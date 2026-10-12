from app.scale import BODY_COMPOSITION, ScaleListener, parse

from .packets import packet


def test_parse_settling_weight():
    r = parse(packet(82.8))
    assert r.weight_kg == 82.8
    assert not r.stabilized and not r.removed
    assert r.impedance is None
    assert r.scale_time == "2026-10-12T07:30:00"


def test_parse_stabilized_with_impedance():
    r = parse(packet(82.8, impedance=480, stabilized=True))
    assert r.stabilized and r.impedance == 480


def test_impedance_still_measuring_is_ignored():
    # While calculating, the scale sends 0xfffe as the impedance.
    r = parse(packet(82.8, stabilized=True, impedance_raw=0xFFFE))
    assert r.impedance is None


def test_parse_pounds():
    r = parse(packet(82.8, lbs=True, stabilized=True))
    assert abs(r.weight_kg - 82.8) < 0.01


def test_parse_removed_and_wrong_length():
    assert parse(packet(70, impedance=500, stabilized=True, removed=True)).removed
    assert parse(b"\x00" * 12) is None


def test_listener_dedupes_and_filters_by_address():
    got = []
    listener = ScaleListener(got.append, address="aa:bb:cc:dd:ee:ff")
    data = {BODY_COMPOSITION: packet(70, stabilized=True)}
    listener.handle("AA:BB:CC:DD:EE:FF", "MIBFS", -60, data)
    listener.handle("AA:BB:CC:DD:EE:FF", "MIBFS", -60, data)    # same advertisement repeated
    listener.handle("11:22:33:44:55:66", "MIBFS", -60, data)    # another scale
    assert len(got) == 1
    assert got[0].address == "AA:BB:CC:DD:EE:FF" and got[0].rssi == -60
    assert set(listener.devices) == {"AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"}
