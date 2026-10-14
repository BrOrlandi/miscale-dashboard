"""Mi Scale Dashboard: live weight from the Xiaomi Mi Body Composition Scale 2, profiles and history."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis, notify
from .db import DB
from .scale import Reading, ScaleListener, parse
from .session import DEFAULT_TOLERANCE_KG, Session, guess_profile, metrics_for

logging.basicConfig(level=os.environ.get("MISCALE_LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("miscale")

STATIC = Path(__file__).parent / "static"
DB_PATH = os.environ.get("MISCALE_DB", "/data/miscale.db")
PHOTOS = Path(DB_PATH).parent / "photos"
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
SCANNER = os.environ.get("MISCALE_SCANNER", "off").lower() in ("on", "1", "true", "yes")
# How long to wait for the impedance before sending the notification.
NOTIFY_WAIT = float(os.environ.get("MISCALE_NOTIFY_WAIT", "25"))

db = DB(DB_PATH)

DEFAULTS = {
    # A weigh-in farther than this from every profile's last weight is saved as "unknown".
    "tolerance_kg": DEFAULT_TOLERANCE_KG,
    # Display unit for weights: "kg" or "lb". Everything is stored in kg.
    "unit": "kg",
}


def settings() -> dict:
    return {**DEFAULTS, **db.settings()}


class Hub:
    """Connected browsers, fed over WebSocket."""

    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def send(self, msg: dict):
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                self.clients.discard(ws)


hub = Hub()
session = Session(db, tolerance=lambda: float(settings()["tolerance_kg"]))
listener = ScaleListener(lambda r: on_reading(r), os.environ.get("MISCALE_SCALE_MAC") or None)
# Measurements waiting for the impedance before the full notification goes out.
waiting: dict[int, asyncio.Event] = {}


async def notify_when_ready(mid: int):
    event = waiting.setdefault(mid, asyncio.Event())
    try:
        await asyncio.wait_for(event.wait(), timeout=NOTIFY_WAIT)
    except TimeoutError:
        pass
    finally:
        waiting.pop(mid, None)
    m = db.get(mid)
    if not m:
        return
    profile = db.profile(m["profile_id"]) if m["profile_id"] else None
    if not profile:
        # A weight that matches nobody (an object, a pet, a guest) stays in the history only.
        log.info("measurement %s has no owner (%.2f kg): not notifying", mid, m["weight_kg"])
        return
    history = [h for h in db.list(m["profile_id"], limit=50) if h["id"] != mid]
    await notify.send(notify.message(m, profile, history, settings()["unit"]), m, profile)


def on_reading(r: Reading):
    at = datetime.now().isoformat(timespec="milliseconds")
    db.log_packet(at, r.address, r.rssi, r.raw)
    loop = asyncio.get_running_loop()
    loop.create_task(hub.send({"type": "live", "at": at, "weight_kg": r.weight_kg, "impedance": r.impedance,
                               "stabilized": r.stabilized, "removed": r.removed, "rssi": r.rssi, "raw": r.raw}))
    result = session.handle(r)
    if result:
        loop.create_task(hub.send({"type": "measurement", **result}))
        mid = result["measurement"]["id"]
        if result["event"] == "saved" and notify.enabled():
            loop.create_task(notify_when_ready(mid))
        if result["measurement"]["impedance"] and mid in waiting:
            waiting[mid].set()


# ---------- Weekly analysis (optional) ----------
NO_WEIGH_INS = "no weigh-in in the last 7 days"
writing: set[int] = set()   # profiles whose analysis is being written right now


async def run_analysis(profile_id: int, week_end: date, kind: str, send: bool = False) -> dict:
    """Writes the analysis of the 7 days ending on `week_end`, streaming it to every open browser."""
    if not analysis.enabled():
        raise HTTPException(503, "AI analysis is not configured (set MISCALE_AI_API_KEY)")
    p = db.profile(profile_id)
    if not p:
        raise HTTPException(404, "profile not found")
    data = analysis.stats(p, db.list(profile_id, limit=100000), week_end, settings()["unit"])
    if not data["weigh_ins"]:
        raise HTTPException(409, NO_WEIGH_INS)
    if profile_id in writing:
        raise HTTPException(409, "an analysis for this profile is already being written")
    writing.add(profile_id)
    loop = asyncio.get_running_loop()
    # The model writes in a thread; its pieces go out over the WebSocket in order.
    pieces: asyncio.Queue = asyncio.Queue()

    async def pump():
        while (item := await pieces.get()) is not None:
            await hub.send({"type": "analysis_delta", "profile_id": profile_id, "text": item[0], "reset": item[1]})

    pumping = asyncio.create_task(pump())
    try:
        await hub.send({"type": "analysis_start", "profile_id": profile_id})
        text, model = await asyncio.to_thread(
            analysis.generate, data, lambda piece, reset: loop.call_soon_threadsafe(pieces.put_nowait, (piece, reset)))
    except RuntimeError as exc:
        log.warning("analysis of %s failed: %s", p["name"], exc)
        await hub.send({"type": "analysis_error", "profile_id": profile_id})
        raise HTTPException(502, f"the AI provider failed: {exc}") from exc
    finally:
        pieces.put_nowait(None)
        await pumping
        writing.discard(profile_id)
    start, end = analysis.week_bounds(week_end)
    aid = db.add_analysis({"profile_id": profile_id, "week_start": start.isoformat(), "week_end": end.isoformat(),
                           "kind": kind, "created_at": datetime.now().isoformat(timespec="seconds"),
                           "model": model, "lang": analysis.lang(), "text": text, "data": data})
    saved = next(a for a in db.analyses(profile_id, limit=5) if a["id"] == aid)
    log.info("analysis %s (%s) of %s written by %s", aid, kind, p["name"], model)
    await hub.send({"type": "analysis", "profile_id": profile_id, "analysis": saved})
    if send and notify.enabled():
        await notify.send(notify.analysis_message(saved, p, analysis.lang()), profile=p, analysis=saved)
    return saved


async def weekly_scheduler():
    """Every week (MISCALE_AI_WEEKDAY at MISCALE_AI_HOUR), one analysis per profile that weighed in.

    If the server was off at that time, it catches up within two days. A failure is retried
    30 minutes later.
    """
    retry_at: dict[int, datetime] = {}
    while True:
        try:
            now = datetime.now()
            day = analysis.due_week_end(now)
            for p in db.profiles() if day else []:
                if db.has_weekly(p["id"], day.isoformat()) or retry_at.get(p["id"], now) > now:
                    continue
                try:
                    await run_analysis(p["id"], day, "weekly", send=True)
                except HTTPException as exc:
                    # No weigh-in this week: nothing to do until next week. Busy or failed: try again soon.
                    later = timedelta(days=3) if exc.detail == NO_WEIGH_INS else timedelta(minutes=30)
                    retry_at[p["id"]] = now + later
                except Exception:
                    log.exception("weekly analysis of %s failed", p["name"])
                    retry_at[p["id"]] = now + timedelta(minutes=30)
        except Exception:
            log.exception("weekly analysis scheduler")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app):
    tasks = []
    if SCANNER:
        tasks.append(asyncio.create_task(listener.run()))
    else:
        log.info("BLE scanner disabled (MISCALE_SCANNER=off)")
    if analysis.enabled():
        tasks.append(asyncio.create_task(weekly_scheduler()))
        log.info("weekly AI analysis on: %s at %s, every %s at %02d:00", ", ".join(analysis.MODELS), analysis.BASE_URL,
                 analysis.WEEKDAYS[analysis.WEEKDAY], analysis.HOUR)
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Mi Scale Dashboard", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


# PWA files live at the root so the service worker controls the whole site.
@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC / "icons" / "favicon.png", media_type="image/png")


@app.get("/api/ping")
def ping():
    return {"ok": True}


def status() -> dict:
    return {
        "scanner": SCANNER,
        "scanner_error": listener.error,
        "last_seen": listener.last_seen.isoformat(timespec="seconds") if listener.last_seen else None,
    }


@app.get("/api/status")
def get_status():
    return status()


# ---------- Measurements ----------
@app.get("/api/measurements")
def measurements(profile_id: int | None = None, limit: int = 1000):
    return db.list(profile_id, limit)


class MeasurementPatch(BaseModel):
    profile_id: int | None


@app.patch("/api/measurements/{mid}")
def patch_measurement(mid: int, patch: MeasurementPatch):
    m = db.get(mid)
    if not m:
        raise HTTPException(404)
    if patch.profile_id is not None and not db.profile(patch.profile_id):
        raise HTTPException(404, "profile not found")
    db.update(mid, profile_id=patch.profile_id,
              metrics=metrics_for(db, patch.profile_id, m["weight_kg"], m["impedance"], m["measured_at"]))
    return db.get(mid)


@app.delete("/api/measurements/{mid}")
def delete_measurement(mid: int):
    db.delete(mid)
    return {"ok": True}


# ---------- Profiles ----------
class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    height_cm: float | None = Field(None, gt=50, lt=260)
    birth: str | None = None
    male: bool = True
    ref_weight: float | None = Field(None, gt=0, lt=300)
    color: str | None = None


def recompute(profile_id: int):
    for m in db.list(profile_id, limit=100000):
        db.update(m["id"], metrics=metrics_for(db, profile_id, m["weight_kg"], m["impedance"], m["measured_at"]))


@app.get("/api/profiles")
def list_profiles():
    return db.profiles()


@app.post("/api/profiles")
def create_profile(p: Profile):
    return db.profile(db.save_profile(p.model_dump()))


@app.put("/api/profiles/{pid}")
def update_profile(pid: int, p: Profile):
    if not db.profile(pid):
        raise HTTPException(404)
    db.save_profile({**p.model_dump(), "id": pid})
    recompute(pid)
    return db.profile(pid)


@app.delete("/api/profiles/{pid}")
def delete_profile(pid: int):
    for old in PHOTOS.glob(f"{pid}.*"):
        old.unlink()
    db.delete_profile(pid)
    return {"ok": True}


@app.put("/api/profiles/{pid}/photo")
async def upload_photo(pid: int, request: Request):
    """Profile photo as the raw request body (the browser already crops and shrinks it)."""
    if not db.profile(pid):
        raise HTTPException(404)
    ext = PHOTO_TYPES.get(request.headers.get("content-type", "").split(";")[0])
    if not ext:
        raise HTTPException(415, "send a JPEG, PNG or WebP image")
    data = await request.body()
    if not data or len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "empty photo or larger than 8 MB")
    PHOTOS.mkdir(parents=True, exist_ok=True)
    for old in PHOTOS.glob(f"{pid}.*"):
        old.unlink()
    (PHOTOS / f"{pid}{ext}").write_bytes(data)
    db.set_photo(pid, f"{pid}{ext}?v={int(datetime.now().timestamp())}")
    return db.profile(pid)


@app.get("/api/profiles/{pid}/photo")
def get_photo(pid: int):
    p = db.profile(pid)
    if not p or not p.get("photo"):
        raise HTTPException(404)
    path = PHOTOS / p["photo"].split("?")[0]
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.delete("/api/profiles/{pid}/photo")
def delete_photo(pid: int):
    for old in PHOTOS.glob(f"{pid}.*"):
        old.unlink()
    db.set_photo(pid, None)
    return db.profile(pid)


# ---------- Weekly analysis ----------
@app.get("/api/analyses")
def list_analyses(profile_id: int | None = None, limit: int = 20):
    return db.analyses(profile_id, limit)


@app.post("/api/analyses/run")
async def run_analysis_now(profile_id: int, send: bool = False):
    """Writes the analysis of the last 7 days now. It is notified only with send=true."""
    return await run_analysis(profile_id, date.today(), "manual", send)


# ---------- Settings ----------
def public_settings() -> dict:
    """Settings plus what the UI needs to know about the weekly analysis (read-only)."""
    return {**settings(), "ai_enabled": analysis.enabled(), "ai_weekday": analysis.WEEKDAY, "ai_hour": analysis.HOUR}


@app.get("/api/settings")
def get_settings():
    return public_settings()


class SettingsPatch(BaseModel):
    tolerance_kg: float | None = Field(None, gt=0, le=50)
    unit: Literal["kg", "lb"] | None = None


@app.put("/api/settings")
def put_settings(patch: SettingsPatch):
    db.set_settings(patch.model_dump(exclude_none=True))
    return public_settings()


# ---------- Remote scale data (ESP32 / LAN) ----------
class RawPacket(BaseModel):
    raw: str
    address: str = ""
    rssi: int | None = None


@app.post("/api/scale/raw")
@app.post("/api/raw")
async def receive_raw_scale_packet(packet: RawPacket):
    """Receives raw BLE broadcast advertisement packets from an external reader (e.g. ESP32)."""
    try:
        data = bytes.fromhex(packet.raw)
    except ValueError:
        raise HTTPException(400, "invalid hex string in raw payload")

    reading = parse(data)
    if reading is None:
        return {"status": "ignored", "reason": "invalid payload"}

    addr = packet.address.upper() if packet.address else ""
    if listener.address and addr and addr != listener.address:
        return {"status": "ignored", "reason": "mac filter mismatch"}

    reading.address = addr
    reading.rssi = packet.rssi
    listener.last_seen = datetime.now()

    if addr:
        listener.devices[addr] = {
            "address": addr,
            "name": "MIBFS (via ESP32)",
            "rssi": packet.rssi,
            "service_data": {"0000181b-0000-1000-8000-00805f9b34fb": packet.raw.lower()},
            "manufacturer": {},
            "uuids": ["0000181b-0000-1000-8000-00805f9b34fb"],
            "seen": datetime.now().isoformat(timespec="seconds"),
        }

    # Deduplicate repeated packets
    if listener.last_raw.get(addr) == reading.raw:
        return {"status": "duplicate"}
    listener.last_raw[addr] = reading.raw

    on_reading(reading)
    return {
        "status": "ok",
        "weight_kg": reading.weight_kg,
        "stabilized": reading.stabilized,
        "impedance": reading.impedance,
    }


# ---------- Debugging ----------
@app.get("/api/debug/devices")
def debug_devices():
    """Every BLE device the adapter has seen, to find your scale's address."""
    return sorted(listener.devices.values(), key=lambda d: d["seen"], reverse=True)


@app.get("/api/debug/packets")
def debug_packets(limit: int = 100):
    """Latest raw packets received from the scale."""
    return db.packets(limit)


@app.post("/api/debug/simulate")
async def simulate(weight: float = 75.0, impedance: int = 500):
    """Plays a fake weigh-in in every open browser. Nothing is saved."""
    pid = guess_profile(db, weight, float(settings()["tolerance_kg"]))
    when = datetime.now().isoformat(timespec="seconds")

    def fake(imp):
        # Same shape as a saved measurement so the screen can show the result; not in the database.
        return {"type": "measurement", "event": "simulated", "measurement": {
            "id": -1, "measured_at": when, "weight_kg": weight, "impedance": imp, "profile_id": pid,
            "metrics": metrics_for(db, pid, weight, imp, when)}}

    def live(w, imp=None, stabilized=False, removed=False):
        return {"type": "live", "weight_kg": round(w, 2), "impedance": imp, "stabilized": stabilized,
                "removed": removed, "simulated": True}

    async def run():
        for f in (0.3, 0.7, 0.95, 1.01, 0.995, 1.002, 1.0):
            await hub.send(live(weight * f))
            await asyncio.sleep(0.5)
        await hub.send(live(weight, stabilized=True))
        await hub.send(fake(None))
        await asyncio.sleep(3)
        await hub.send(live(weight, impedance, stabilized=True))
        await hub.send(fake(impedance))
        await asyncio.sleep(3)
        await hub.send(live(weight, impedance, stabilized=True, removed=True))

    asyncio.create_task(run())
    return {"ok": True}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    hub.clients.add(websocket)
    await websocket.send_json({"type": "status", **status()})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(websocket)
