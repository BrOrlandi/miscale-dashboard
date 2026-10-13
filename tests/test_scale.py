from app.scale import ScaleListener, parse, parse_broadcast, parse_gatt_notification

try:
    from .packets import broadcast_packet, gatt_measured_packet, gatt_measuring_packet
except ImportError:
    from tests.packets import broadcast_packet, gatt_measured_packet, gatt_measuring_packet


def test_parse_broadcast_measuring():
    r = parse(broadcast_packet(75.5, stabilized=False))
    assert r is not None
    assert r.weight_kg == 75.5
    assert not r.stabilized
    assert r.impedance is None


def test_parse_broadcast_stabilized():
    r = parse(broadcast_packet(75.5, impedance=520, stabilized=True))
    assert r is not None
    assert r.weight_kg == 75.5
    assert r.stabilized
    assert r.impedance == 520


def test_parse_gatt_measuring():
    r = parse_gatt_notification(gatt_measuring_packet(72.3))
    assert r is not None
    assert r.weight_kg == 72.3
    assert not r.stabilized
    assert r.impedance is None


def test_parse_gatt_measured():
    r = parse_gatt_notification(gatt_measured_packet(72.3, impedance=490, body_fat=18.5))
    assert r is not None
    assert r.weight_kg == 72.3
    assert r.stabilized
    assert r.impedance == 490
    assert r.body_fat == 18.5


def test_listener_dedupes_and_filters():
    got = []
    listener = ScaleListener(got.append, address="AA:BB:CC:DD:EE:FF")
    pkt = broadcast_packet(70.0, impedance=500, stabilized=True)

    # 1. Matching address and manufacturer data
    listener.handle("AA:BB:CC:DD:EE:FF", "YUNMAI-SCALE", -60, {}, manufacturer_data={1: pkt})
    # Duplicate packet ignored
    listener.handle("AA:BB:CC:DD:EE:FF", "YUNMAI-SCALE", -60, {}, manufacturer_data={1: pkt})
    # Other scale ignored
    listener.handle("11:22:33:44:55:66", "YUNMAI-SCALE", -60, {}, manufacturer_data={1: pkt})

    assert len(got) == 1
    assert got[0].address == "AA:BB:CC:DD:EE:FF"
    assert got[0].weight_kg == 70.0
    assert got[0].impedance == 500
