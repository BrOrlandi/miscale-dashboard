"""Reads Yunmai smart scales over Bluetooth Low Energy (BLE).

Supports both:
1. Passive Broadcast Mode (Advertising / Connectionless):
   The scale broadcasts real-time and stabilized measurements without pairing.
2. GATT Connected Mode:
   For models like Yunmai Mini, SE, Premium that communicate over GATT
   service 0xFFE0 / characteristics 0xFFE4 (notify) and 0xFFE9 (write).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

log = logging.getLogger("yunmai.scale")

# Yunmai GATT UUIDs
YUNMAI_SVC_MEAS = "0000ffe0-0000-1000-8000-00805f9b34fb"
YUNMAI_CHR_NOTIFY = "0000ffe4-0000-1000-8000-00805f9b34fb"
YUNMAI_SVC_CMD = "0000ffe5-0000-1000-8000-00805f9b34fb"
YUNMAI_CHR_WRITE = "0000ffe9-0000-1000-8000-00805f9b34fb"


@dataclass
class Reading:
    address: str
    rssi: int | None
    raw: str
    weight_kg: float
    impedance: int | None
    body_fat: float | None
    stabilized: bool
    removed: bool
    scale_time: str | None


def build_user_packet(uid: int = 1, height_cm: int = 175, male: bool = True, age: int = 30, kg: bool = True) -> bytes:
    """Builds the 0x10 SET_USER packet expected by Yunmai GATT scales."""
    sex = 0x01 if male else 0x02
    unit = 0x01 if kg else 0x02
    payload = bytearray([
        0x0D, 0x12, 0x10, 0x01, 0x00, 0x00,
        (uid >> 8) & 0xFF, uid & 0xFF,
        int(height_cm) & 0xFF,
        sex,
        int(age) & 0xFF,
        0x55, 0x5A, 0x00, 0x00,
        unit, 0x00, 0x00,
    ])
    xor = 0
    for b in payload[1:-1]:
        xor ^= b
    payload[-1] = xor
    return bytes(payload)


def build_set_time_packet(now_ts: int | None = None) -> bytes:
    """Builds the 0x11 SET_TIME packet expected by Yunmai GATT scales."""
    now = int(datetime.now().timestamp()) if now_ts is None else now_ts
    payload = bytearray([
        0x0D, 0x0D, 0x11,
        (now >> 24) & 0xFF, (now >> 16) & 0xFF, (now >> 8) & 0xFF, now & 0xFF,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    xor = 0
    for b in payload[1:-1]:
        xor ^= b
    payload[-1] = xor
    return bytes(payload)


def parse_broadcast(data: bytes) -> Reading | None:
    """Decodes a Yunmai passive advertisement scan record."""
    # Full scan record: at least 24 bytes
    # Byte 19 (hex[38:40]): 01/02 = real-time, 03 = stabilized
    # Byte 20..21 (hex[40:44]): weight in kg * 100
    # Byte 22..23 (hex[44:48]): resistance in ohms
    if len(data) >= 24:
        # Check standard Yunmai scan record offset (byte 19)
        status = data[19]
        if status in (0x01, 0x02, 0x03):
            raw_weight = int.from_bytes(data[20:22], "big")
            weight = raw_weight * 0.01
            if 0 < weight < 300:
                impedance = int.from_bytes(data[22:24], "big") if len(data) >= 24 else None
                if impedance is not None and not (0 < impedance < 3000):
                    impedance = None
                return Reading(
                    address="",
                    rssi=None,
                    raw=data.hex(),
                    weight_kg=round(weight, 2),
                    impedance=impedance,
                    body_fat=None,
                    stabilized=(status == 0x03),
                    removed=(weight == 0),
                    scale_time=datetime.now().isoformat(timespec="seconds"),
                )

    # Manufacturer data payload (where data doesn't include 7-byte AD header)
    if len(data) >= 17:
        for offset in (12, 14, 0):
            if offset + 5 <= len(data):
                status = data[offset]
                if status in (0x01, 0x02, 0x03):
                    raw_weight = int.from_bytes(data[offset + 1:offset + 3], "big")
                    weight = raw_weight * 0.01
                    if 5.0 <= weight <= 250.0:
                        impedance = int.from_bytes(data[offset + 3:offset + 5], "big") if offset + 5 <= len(data) else None
                        if impedance is not None and not (0 < impedance < 3000):
                            impedance = None
                        return Reading(
                            address="",
                            rssi=None,
                            raw=data.hex(),
                            weight_kg=round(weight, 2),
                            impedance=impedance,
                            body_fat=None,
                            stabilized=(status == 0x03),
                            removed=False,
                            scale_time=datetime.now().isoformat(timespec="seconds"),
                        )
    return None


def parse_gatt_notification(data: bytes) -> Reading | None:
    """Decodes a notification packet from characteristic 0xFFE4."""
    if len(data) < 10 or data[0] != 0x0D:
        return None

    opcode = data[3]
    # Opcode 0x01 = Measuring (real-time)
    if opcode == 0x01:
        # Real-time weight at byte 8..9 or 13..14
        if len(data) >= 10:
            weight = int.from_bytes(data[8:10], "big") * 0.01
            if 0 < weight < 300:
                return Reading(
                    address="",
                    rssi=None,
                    raw=data.hex(),
                    weight_kg=round(weight, 2),
                    impedance=None,
                    body_fat=None,
                    stabilized=False,
                    removed=False,
                    scale_time=None,
                )

    # Opcode 0x02 = Measured (stabilized)
    if opcode == 0x02 and len(data) >= 17:
        scale_time = None
        ts = int.from_bytes(data[5:9], "big")
        if ts > 315532800:  # Valid timestamp after 1980
            try:
                scale_time = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                pass

        weight = int.from_bytes(data[13:15], "big") * 0.01
        if not (0 < weight < 300):
            return None

        resistance = int.from_bytes(data[15:17], "big")
        impedance = resistance if 0 < resistance < 3000 else None

        body_fat = None
        if len(data) >= 19:
            fat_raw = int.from_bytes(data[17:19], "big") * 0.01
            if 5.0 <= fat_raw <= 75.0:
                body_fat = round(fat_raw, 1)

        return Reading(
            address="",
            rssi=None,
            raw=data.hex(),
            weight_kg=round(weight, 2),
            impedance=impedance,
            body_fat=body_fat,
            stabilized=True,
            removed=False,
            scale_time=scale_time or datetime.now().isoformat(timespec="seconds"),
        )

    return None


def parse(data: bytes) -> Reading | None:
    """Tries parsing a byte payload with any Yunmai format."""
    if data and data[0] == 0x0D:
        r = parse_gatt_notification(data)
        if r is not None:
            return r
    r = parse_broadcast(data)
    if r is not None:
        return r
    return parse_gatt_notification(data)


class ScaleListener:
    """Scans for Yunmai scale advertisements and connects via GATT if required."""

    def __init__(self, on_reading, address: str | None = None):
        self.on_reading = on_reading
        self.address = address.upper() if address else None
        self.last_raw: dict[str, str] = {}
        self.last_seen: datetime | None = None
        self.error: str | None = None
        self.devices: dict[str, dict] = {}
        self._connecting: set[str] = set()

    def is_yunmai_device(self, address: str, name: str | None, service_data: dict, manufacturer_data: dict, uuids: list) -> bool:
        if self.address:
            return address.upper() == self.address
        if name and "YUNMAI" in name.upper():
            return True
        for uuid in (uuids or []):
            if "ffe0" in uuid.lower():
                return True
        for k in service_data:
            if "ffe0" in k.lower():
                return True
        return False

    def handle(self, address: str, name: str | None, rssi: int | None, service_data: dict,
               manufacturer_data: dict | None = None, uuids: list | None = None):
        manufacturer_data = manufacturer_data or {}
        uuids = uuids or []
        self.devices[address] = {
            "address": address,
            "name": name,
            "rssi": rssi,
            "service_data": {k: v.hex() for k, v in service_data.items()},
            "manufacturer": {str(k): v.hex() for k, v in manufacturer_data.items()},
            "uuids": uuids,
            "seen": datetime.now().isoformat(timespec="seconds"),
        }

        if not self.is_yunmai_device(address, name, service_data, manufacturer_data, uuids):
            return

        log.info("Yunmai scale seen: %s (%s) RSSI %s | mfg=%s | svc=%s",
                 address, name, rssi, {k: v.hex() for k, v in manufacturer_data.items()},
                 {k: v.hex() for k, v in service_data.items()})

        # 1. Check if broadcast payload is present in manufacturer_data or service_data
        for raw_bytes in list(manufacturer_data.values()) + list(service_data.values()):
            reading = parse_broadcast(raw_bytes)
            if reading:
                reading.address = address
                reading.rssi = rssi
                self._emit_reading(reading)
                return

        # 2. For GATT models (openScale style), trigger active connection if not already connecting
        if address not in self._connecting:
            asyncio.create_task(self._connect_and_read_gatt(address, name))

    def _emit_reading(self, reading: Reading):
        self.last_seen = datetime.now()
        if self.last_raw.get(reading.address) == reading.raw:
            return
        self.last_raw[reading.address] = reading.raw
        self.on_reading(reading)

    async def _connect_and_read_gatt(self, address: str, name: str | None):
        from bleak import BleakClient

        self._connecting.add(address)
        try:
            log.info("Connecting to Yunmai scale %s (%s)...", address, name or "Unknown")
            async with BleakClient(address, timeout=12.0) as client:
                if not client.is_connected:
                    return

                log.info("Connected to %s (%s). Discovering services...", address, name)
                has_measured = asyncio.Event()

                def callback(char, data: bytearray):
                    raw_hex = bytes(data).hex()
                    log.info("Scale notification on %s: %s (len %d)", char, raw_hex, len(data))
                    reading = parse_gatt_notification(bytes(data))
                    if reading:
                        reading.address = address
                        reading.rssi = None
                        self._emit_reading(reading)
                        if reading.stabilized:
                            has_measured.set()

                # Find notify and write characteristics
                notify_char = None
                write_char = None
                for svc in client.services:
                    log.debug("Scale service: %s (%s)", svc.uuid, svc.description)
                    for char in svc.characteristics:
                        uuid_lower = char.uuid.lower()
                        log.debug("   Char: %s props=%s", char.uuid, char.properties)
                        if "notify" in char.properties or "indicate" in char.properties:
                            if notify_char is None or "ffe4" in uuid_lower or "2a9c" in uuid_lower or "1013" in uuid_lower:
                                notify_char = char.uuid
                        if "write" in char.properties or "write-without-response" in char.properties:
                            if write_char is None or "ffe9" in uuid_lower or "1014" in uuid_lower:
                                write_char = char.uuid

                if not notify_char:
                    log.warning("No notification characteristic found on %s", address)
                    return

                log.info("Subscribing to notify char: %s (write char: %s)", notify_char, write_char)
                await client.start_notify(notify_char, callback)

                # Send user & time configuration packets if write characteristic is available
                if write_char:
                    try:
                        await client.write_gatt_char(write_char, build_user_packet(), response=False)
                        await asyncio.sleep(0.1)
                        await client.write_gatt_char(write_char, build_set_time_packet(), response=False)
                    except Exception as e:
                        log.debug("Handshake write error on %s: %s", address, e)

                # Wait for stabilized measurement or timeout
                try:
                    await asyncio.wait_for(has_measured.wait(), timeout=25.0)
                    # Allow 3 seconds after stabilization for final updates
                    await asyncio.sleep(3.0)
                except TimeoutError:
                    pass
                finally:
                    try:
                        await client.stop_notify(notify_char)
                    except Exception:
                        pass
        except Exception as e:
            log.debug("GATT connection to %s ended: %s", address, e)
        finally:
            self._connecting.discard(address)

    def _callback(self, device, adv):
        self.handle(device.address, adv.local_name or device.name, adv.rssi, adv.service_data,
                    adv.manufacturer_data, adv.service_uuids)

    async def run(self):
        from bleak import BleakScanner

        while True:
            try:
                async with BleakScanner(self._callback, scanning_mode="active"):
                    log.info("listening for Yunmai scale over BLE")
                    self.error = None
                    while True:
                        await asyncio.sleep(3600)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.error = str(exc)
                log.exception("BLE scanner stopped; retrying in 10 s")
                await asyncio.sleep(10)
