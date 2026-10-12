"""Reads the Xiaomi Mi Body Composition Scale 2 (XMTZC05HM) from its BLE advertisements.

The scale needs no connection or pairing: while someone is standing on it, it advertises
the Body Composition service (0x181B) with 13 bytes of service data:

    [0]     control byte 0  (bit 0: pounds)
    [1]     control byte 1  (bit 1: has impedance, bit 5: stabilized,
                             bit 6: date invalid, bit 7: person stepped off)
    [2:4]   year (little endian)
    [4..8]  month, day, hour, minute, second
    [9:11]  impedance in ohms (little endian)
    [11:13] weight (little endian; /200 for kg, /100 for pounds)
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime

log = logging.getLogger("miscale.scale")

BODY_COMPOSITION = "0000181b-0000-1000-8000-00805f9b34fb"
LB = 0.45359237


@dataclass
class Reading:
    address: str
    rssi: int | None
    raw: str
    weight_kg: float
    impedance: int | None
    stabilized: bool
    removed: bool
    scale_time: str | None


def parse(data: bytes) -> Reading | None:
    """Decodes one advertisement payload, or returns None if it is not a scale packet."""
    if len(data) != 13:
        return None
    c0, c1 = data[0], data[1]
    lbs = bool(c0 & 0x01)
    weight = int.from_bytes(data[11:13], "little") / (100 if lbs else 200)
    if lbs:
        weight *= LB
    impedance = int.from_bytes(data[9:11], "little") if c1 & 0x02 else None
    # While still measuring, the scale sends 0xfffe / 0xffff as impedance.
    if impedance is not None and not 0 < impedance < 3000:
        impedance = None
    scale_time = None
    if not c1 & 0x40:
        try:
            year = int.from_bytes(data[2:4], "little")
            scale_time = datetime(year, *data[4:9]).isoformat()
        except ValueError:
            pass
    return Reading(
        address="",
        rssi=None,
        raw=data.hex(),
        weight_kg=round(weight, 2),
        impedance=impedance,
        stabilized=bool(c1 & 0x20),
        removed=bool(c1 & 0x80),
        scale_time=scale_time,
    )


class ScaleListener:
    """Scans for advertisements and calls `on_reading` for every new scale packet."""

    def __init__(self, on_reading, address: str | None = None):
        self.on_reading = on_reading
        self.address = address.upper() if address else None
        self.last_raw: dict[str, str] = {}
        self.last_seen: datetime | None = None
        self.error: str | None = None
        # Everything the radio sees, to help find a scale that advertises differently.
        self.devices: dict[str, dict] = {}

    def handle(self, address: str, name: str | None, rssi: int | None, service_data: dict,
               manufacturer_data: dict | None = None, uuids: list | None = None):
        self.devices[address] = {
            "address": address,
            "name": name,
            "rssi": rssi,
            "service_data": {k: v.hex() for k, v in service_data.items()},
            "manufacturer": {str(k): v.hex() for k, v in (manufacturer_data or {}).items()},
            "uuids": uuids or [],
            "seen": datetime.now().isoformat(timespec="seconds"),
        }
        data = service_data.get(BODY_COMPOSITION)
        if not data:
            return
        if self.address and address.upper() != self.address:
            return
        reading = parse(data)
        if reading is None:
            return
        reading.address = address
        reading.rssi = rssi
        self.last_seen = datetime.now()
        # BlueZ repeats the same advertisement; only forward it when the content changes.
        if self.last_raw.get(address) == reading.raw:
            return
        self.last_raw[address] = reading.raw
        self.on_reading(reading)

    def _callback(self, device, adv):
        self.handle(device.address, adv.local_name or device.name, adv.rssi, adv.service_data,
                    adv.manufacturer_data, adv.service_uuids)

    async def run(self):
        from bleak import BleakScanner

        while True:
            try:
                async with BleakScanner(self._callback, scanning_mode="active"):
                    log.info("listening for the scale over BLE")
                    self.error = None
                    while True:
                        await asyncio.sleep(3600)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # BlueZ restarted, adapter went away, etc.
                self.error = str(exc)
                log.exception("BLE scanner stopped; retrying in 10 s")
                await asyncio.sleep(10)
