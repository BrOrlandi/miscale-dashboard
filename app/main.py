"""Yunmai Scale Dashboard: live weight from Yunmai smart scales, profiles and history."""

from __future__ import annotations

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
from .scale import Reading, ScaleListener
from .session import DEFAULT_TOLERANCE_KG, Session, guess_profile, metrics_for

LOG_LEVEL = os.environ.get("YUNMAI_LOG_LEVEL") or os.environ.get("MISCALE_LOG_LEVEL", "INFO")
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("yunmai")

STATIC = Path(__file__).parent / "static"
DEFAULT_DB = "/data/yunmai.db" if os.name != "nt" else "data/yunmai.db"
DB_PATH = os.environ.get("YUNMAI_DB") or os.environ.get("MISCALE_DB", DEFAULT_DB)
PHOTOS = Path(DB_PATH).parent / "photos"
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
SCANNER_ENV = os.environ.get("YUNMAI_SCANNER") or os.environ.get("MISCALE_SCANNER", "on")
SCANNER = SCANNER_ENV.lower() not in ("off", "0", "false", "no")
NOTIFY_WAIT = float(os.environ.get("YUNMAI_NOTIFY_WAIT") or os.environ.get("MISCALE_NOTIFY_WAIT", "25"))
SCALE_MAC = os.environ.get("YUNMAI_SCALE_MAC") or os.environ.get("MISCALE_SCALE_MAC") or None

db = DB(DB_PATH)

DEFAULTS = {
    "tolerance_kg": DEFAULT_TOLERANCE_KG,
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
listener = ScaleListener(lambda r: on_reading(r), SCALE_MAC)
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
        log.info("measurement %s has no owner (%.2f kg): not notifying", mid, m["weight_kg"])
        return
    history = [h for h in db.list(m["profile_id"], limit=50) if h["id"] != mid]
    await notify.send(notify.message(m, profile, history, settings()["unit"]), m, profile)


def on_reading(r: Reading):
    at = datetime.now().isoformat(timespec="milliseconds")
    db.log_packet(at, r.address, r.rssi, r.raw)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(hub.send({
        "type": "live", "at": at, "weight_kg": r.weight_kg, "impedance": r.impedance,
        "stabilized": r.stabilized, "removed": r.removed, "rssi": r.rssi, "raw": r.raw
    }))
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
writing: set[int] = set()


async def run_analysis(profile_id: int, week_end: date, kind: str, send: bool = False) -> dict:
    if not analysis.enabled():
        raise HTTPException(503, "AI analysis is not configured (set YUNMAI_AI_API_KEY)")
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
        log.info("BLE scanner disabled (YUNMAI_SCANNER=off)")
    if analysis.enabled():
        tasks.append(asyncio.create_task(weekly_scheduler()))
        log.info("weekly AI analysis on: %s at %s, every %s at %02d:00", ", ".join(analysis.MODELS), analysis.BASE_URL,
                 analysis.WEEKDAYS[analysis.WEEKDAY], analysis.HOUR)
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Yunmai Scale Dashboard", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


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
@app.get("/health")
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
    return await run_analysis(profile_id, date.today(), "manual", send)


# ---------- Settings ----------
def public_settings() -> dict:
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


# ---------- Debugging ----------
@app.get("/api/debug/devices")
def debug_devices():
    return sorted(listener.devices.values(), key=lambda d: d["seen"], reverse=True)


@app.get("/api/debug/packets")
def debug_packets(limit: int = 100):
    return db.packets(limit)


@app.post("/api/debug/simulate")
async def simulate(weight: float = 75.0, impedance: int = 500):
    pid = guess_profile(db, weight, float(settings()["tolerance_kg"]))
    when = datetime.now().isoformat(timespec="seconds")

    def fake(imp):
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


@app.websocket("/ws/bridge")
async def ws_bridge(websocket: WebSocket):
    await websocket.accept()
    try:
        await websocket.close(code=1000)
    except Exception:
        pass
