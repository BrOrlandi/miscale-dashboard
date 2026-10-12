"""SQLite storage: measurements, profiles, settings and raw packets (for debugging)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at TEXT NOT NULL,
    scale_time TEXT,
    weight_kg REAL NOT NULL,
    impedance INTEGER,
    profile_id INTEGER,
    metrics TEXT,
    raw TEXT,
    address TEXT
);
CREATE INDEX IF NOT EXISTS measurements_at ON measurements(measured_at);
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    height_cm REAL,
    birth TEXT,
    male INTEGER NOT NULL DEFAULT 1,
    ref_weight REAL,
    color TEXT,
    photo TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS packets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    address TEXT,
    rssi INTEGER,
    raw TEXT NOT NULL
);
"""

PROFILE_FIELDS = ("name", "height_cm", "birth", "male", "ref_weight", "color")


class DB:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ---------- Profiles ----------
    def profiles(self) -> list[dict]:
        return [dict(r, male=bool(r["male"])) for r in self.conn.execute("SELECT * FROM profiles ORDER BY id")]

    def profile(self, pid: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM profiles WHERE id = ?", (pid,)).fetchone()
        return dict(row, male=bool(row["male"])) if row else None

    def save_profile(self, p: dict) -> int:
        fields = {k: p.get(k) for k in PROFILE_FIELDS}
        fields["male"] = int(bool(fields["male"]))
        if p.get("id"):
            cols = ", ".join(f"{k} = ?" for k in fields)
            self.conn.execute(f"UPDATE profiles SET {cols} WHERE id = ?", (*fields.values(), p["id"]))
            pid = p["id"]
        else:
            cur = self.conn.execute(
                f"INSERT INTO profiles ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
                tuple(fields.values()))
            pid = cur.lastrowid
        self.conn.commit()
        return pid

    def set_photo(self, pid: int, photo: str | None):
        self.conn.execute("UPDATE profiles SET photo = ? WHERE id = ?", (photo, pid))
        self.conn.commit()

    def delete_profile(self, pid: int):
        self.conn.execute("UPDATE measurements SET profile_id = NULL WHERE profile_id = ?", (pid,))
        self.conn.execute("DELETE FROM profiles WHERE id = ?", (pid,))
        self.conn.commit()

    # ---------- Measurements ----------
    def insert(self, m: dict) -> int:
        cur = self.conn.execute(
            "INSERT INTO measurements (measured_at, scale_time, weight_kg, impedance, profile_id, metrics, raw, address)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (m["measured_at"], m.get("scale_time"), m["weight_kg"], m.get("impedance"),
             m.get("profile_id"), json.dumps(m.get("metrics") or {}), m.get("raw"), m.get("address")),
        )
        self.conn.commit()
        return cur.lastrowid

    def update(self, mid: int, **fields):
        if "metrics" in fields:
            fields["metrics"] = json.dumps(fields["metrics"] or {})
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(f"UPDATE measurements SET {cols} WHERE id = ?", (*fields.values(), mid))
        self.conn.commit()

    def delete(self, mid: int):
        self.conn.execute("DELETE FROM measurements WHERE id = ?", (mid,))
        self.conn.commit()

    def get(self, mid: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM measurements WHERE id = ?", (mid,)).fetchone()
        return _row(row) if row else None

    def list(self, profile_id: int | None = None, limit: int = 1000) -> list[dict]:
        """Newest first."""
        if profile_id:
            rows = self.conn.execute(
                "SELECT * FROM measurements WHERE profile_id = ? ORDER BY measured_at DESC LIMIT ?", (profile_id, limit))
        else:
            rows = self.conn.execute("SELECT * FROM measurements ORDER BY measured_at DESC LIMIT ?", (limit,))
        return [_row(r) for r in rows]

    def last(self, profile_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM measurements WHERE profile_id = ? ORDER BY measured_at DESC LIMIT 1", (profile_id,)).fetchone()
        return _row(row) if row else None

    # ---------- Settings and packets ----------
    def settings(self) -> dict:
        return {r["key"]: json.loads(r["value"]) for r in self.conn.execute("SELECT * FROM settings")}

    def set_settings(self, values: dict):
        for k, v in values.items():
            self.conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)"
                              " ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, json.dumps(v)))
        self.conn.commit()

    def log_packet(self, at, address, rssi, raw, keep: int = 5000):
        self.conn.execute("INSERT INTO packets (at, address, rssi, raw) VALUES (?, ?, ?, ?)",
                          (at, address, rssi, raw))
        # Keep only the most recent packets; they are just for debugging.
        self.conn.execute("DELETE FROM packets WHERE id <= (SELECT MAX(id) FROM packets) - ?", (keep,))
        self.conn.commit()

    def packets(self, limit: int = 100) -> list[dict]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM packets ORDER BY id DESC LIMIT ?", (limit,))]


def _row(row) -> dict:
    d = dict(row)
    d["metrics"] = json.loads(d["metrics"]) if d.get("metrics") else {}
    return d
