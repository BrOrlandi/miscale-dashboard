"""Builds synthetic Yunmai scale packets for testing (both Broadcast and GATT)."""

import time


def broadcast_packet(weight_kg: float, impedance: int | None = None, stabilized: bool = False) -> bytes:
    """Builds a Yunmai passive broadcast packet (full scan record format, 24 bytes).

    - Bytes 0..18: Header / AD prefix (starts with 02 01 04 03)
    - Byte 19: 0x01/0x02 for measuring, 0x03 for stabilized
    - Bytes 20..21: weight in kg * 100 (big endian)
    - Bytes 22..23: impedance in ohms (big endian)
    """
    prefix = bytes([
        0x02, 0x01, 0x04, 0x03, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
        0x01, 0x00, 0x00
    ])
    status = 0x03 if stabilized else 0x01
    weight_int = int(round(weight_kg * 100))
    imp_int = impedance if impedance is not None else 0
    return prefix + bytes([status]) + weight_int.to_bytes(2, "big") + imp_int.to_bytes(2, "big")


def gatt_measuring_packet(weight_kg: float) -> bytes:
    """Builds a GATT notification measuring packet (opcode 0x01)."""
    # 0D [ver] [len] 01 ... [weight BE at 8..10]
    payload = bytearray(14)
    payload[0] = 0x0D
    payload[1] = 0x12
    payload[2] = 0x0A
    payload[3] = 0x01
    w = int(round(weight_kg * 100))
    payload[8] = (w >> 8) & 0xFF
    payload[9] = w & 0xFF
    return bytes(payload)


def gatt_measured_packet(weight_kg: float, impedance: int = 500, body_fat: float | None = None,
                         timestamp: int | None = None) -> bytes:
    """Builds a GATT notification measured packet (opcode 0x02)."""
    ts = timestamp or int(time.time())
    w = int(round(weight_kg * 100))
    payload = bytearray(20)
    payload[0] = 0x0D
    payload[1] = 0x1E if body_fat else 0x13
    payload[2] = 0x14 if body_fat else 0x12
    payload[3] = 0x02
    payload[4] = 0x00
    # timestamp at 5..9
    payload[5:9] = ts.to_bytes(4, "big")
    # user id at 9..13
    payload[9:13] = (1).to_bytes(4, "big")
    # weight at 13..15
    payload[13:15] = w.to_bytes(2, "big")
    # resistance at 15..17
    payload[15:17] = impedance.to_bytes(2, "big")
    if body_fat:
        fat_int = int(round(body_fat * 100))
        payload[17:19] = fat_int.to_bytes(2, "big")
    return bytes(payload)
