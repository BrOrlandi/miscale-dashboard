"""Optional notification for every new weigh-in (and the weekly analysis): a generic webhook and/or Telegram."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

log = logging.getLogger("yunmai.notify")

WEBHOOK = os.environ.get("YUNMAI_WEBHOOK_URL") or os.environ.get("MISCALE_WEBHOOK_URL", "")
TELEGRAM_TOKEN = os.environ.get("YUNMAI_TELEGRAM_TOKEN") or os.environ.get("MISCALE_TELEGRAM_TOKEN", "")
TELEGRAM_CHAT = os.environ.get("YUNMAI_TELEGRAM_CHAT_ID") or os.environ.get("MISCALE_TELEGRAM_CHAT_ID", "")
PUBLIC_URL = os.environ.get("YUNMAI_PUBLIC_URL") or os.environ.get("MISCALE_PUBLIC_URL", "")
LANG = os.environ.get("YUNMAI_LANG") or os.environ.get("MISCALE_LANG", "en")
LB = 0.45359237

TEXT = {
    "en": {
        "unknown": "⚖️ {w} without an owner: the weight doesn't match any profile.\nPick who it was in the history.",
        "since": "{d} since {when}", "avg": "7-day average {w}",
        "fat": "Body fat {fat}% ({mass}) · Muscle {muscle}",
        "water": "Water {water}% · Protein {protein}% · Bone {bone}",
        "bmi": "BMI {bmi} · Visceral fat {visceral} · BMR {bmr} kcal",
        "impedance": "Impedance {imp} Ω",
        "no_impedance": "No impedance (step on barefoot and wait for the measurement to finish).",
        "no_height": "Set height and birth date in the profile to see body composition.",
        "date": "%b %d %H:%M",
        "analysis": "🧠 Weekly analysis · {name} ({start} – {end})", "day": "%b %d",
    },
    "es": {
        "unknown": "⚖️ Pesaje de {w} sin asignar: el peso no coincide con ningún perfil.\nSelecciona a la persona en el historial.",
        "since": "{d} desde {when}", "avg": "media 7 días {w}",
        "fat": "Grasa {fat}% ({mass}) · Músculo {muscle}",
        "water": "Agua {water}% · Proteína {protein}% · Hueso {bone}",
        "bmi": "IMC {bmi} · Grasa visceral {visceral} · Metabolismo basal {bmr} kcal",
        "impedance": "Impedancia {imp} Ω",
        "no_impedance": "Sin impedancia (súbete descalzo y espera a que termine la medición).",
        "no_height": "Configura altura y fecha de nacimiento en el perfil para ver la composición corporal.",
        "date": "%d/%m %H:%M",
        "analysis": "🧠 Análisis semanal · {name} ({start} a {end})", "day": "%d/%m",
    },
    "pt-BR": {
        "unknown": "⚖️ Pesagem de {w} sem dono: o peso não bate com nenhum perfil.\nEscolha a pessoa no histórico.",
        "since": "{d} desde {when}", "avg": "média 7 dias {w}",
        "fat": "Gordura {fat}% ({mass}) · Músculo {muscle}",
        "water": "Água {water}% · Proteína {protein}% · Ossos {bone}",
        "bmi": "IMC {bmi} · Gordura visceral {visceral} · Metabolismo basal {bmr} kcal",
        "impedance": "Impedância {imp} Ω",
        "no_impedance": "Sem impedância (suba descalço e espere o fim da medição).",
        "no_height": "Cadastre altura e nascimento no perfil para ver a composição corporal.",
        "date": "%d/%m %H:%M",
        "analysis": "🧠 Análise da semana · {name} ({start} a {end})", "day": "%d/%m",
    },
}


def enabled() -> bool:
    return bool(WEBHOOK or (TELEGRAM_TOKEN and TELEGRAM_CHAT))


def _num(v, d=1, lang=LANG):
    s = f"{v:,.{d}f}"
    if lang.startswith("pt") or lang.startswith("es"):
        s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return s


def _mass(kg, unit, d=1, lang=LANG):
    return f"{_num(kg / LB, d, lang)} lb" if unit == "lb" else f"{_num(kg, d, lang)} kg"


def message(m: dict, profile: dict | None, history: list[dict], unit: str = "kg", lang: str = LANG) -> str:
    """`history` holds the same person's previous measurements, newest first."""
    lang_key = "es" if lang.startswith("es") else ("pt-BR" if lang.startswith("pt") else "en")
    t = TEXT.get(lang_key, TEXT["en"])
    x = m.get("metrics") or {}
    if not profile:
        lines = [t["unknown"].format(w=_mass(m["weight_kg"], unit, 2, lang))]
        if PUBLIC_URL:
            lines.append(PUBLIC_URL)
        return "\n".join(lines)
    lines = [f"⚖️ {profile['name']} · {_mass(m['weight_kg'], unit, 2, lang)}"]

    when = datetime.fromisoformat(m["measured_at"])
    prev = next((h for h in history if when - datetime.fromisoformat(h["measured_at"]) > timedelta(minutes=3)), None)
    trend = []
    if prev:
        d = m["weight_kg"] - prev["weight_kg"]
        trend.append(t["since"].format(d=("+" if d >= 0 else "−") + _mass(abs(d), unit, 2, lang),
                                       when=datetime.fromisoformat(prev["measured_at"]).strftime(t["date"])))
    week = [h["weight_kg"] for h in [m, *history] if when - datetime.fromisoformat(h["measured_at"]) < timedelta(days=7)]
    if len(week) > 1:
        trend.append(t["avg"].format(w=_mass(sum(week) / len(week), unit, 1, lang)))
    if trend:
        lines.append(" · ".join(trend))

    if x.get("body_fat") is not None:
        lines.append(t["fat"].format(fat=_num(x["body_fat"], 1, lang), mass=_mass(x["fat_mass"], unit, 1, lang),
                                     muscle=_mass(x["muscle_mass"], unit, 1, lang)))
        lines.append(t["water"].format(water=_num(x["water"], 1, lang), protein=_num(x["protein"], 1, lang),
                                       bone=_mass(x["bone_mass"], unit, 1, lang)))
    if x.get("bmi") is not None:
        lines.append(t["bmi"].format(bmi=_num(x["bmi"], 1, lang), visceral=_num(x["visceral_fat"], 0, lang),
                                     bmr=_num(x["bmr"], 0, lang)))
    if m.get("impedance"):
        lines.append(t["impedance"].format(imp=m["impedance"]))
    elif x.get("bmi") is not None:
        lines.append(t["no_impedance"])
    if not profile.get("height_cm") or not profile.get("birth"):
        lines.append(t["no_height"])
    if PUBLIC_URL:
        lines.append(PUBLIC_URL)
    return "\n".join(lines)


def analysis_message(a: dict, profile: dict, lang: str = LANG) -> str:
    lang_key = "es" if lang.startswith("es") else ("pt-BR" if lang.startswith("pt") else "en")
    t = TEXT.get(lang_key, TEXT["en"])
    start, end = (datetime.fromisoformat(a[k]).strftime(t["day"]) for k in ("week_start", "week_end"))
    lines = [t["analysis"].format(name=profile["name"], start=start, end=end), "", a["text"]]
    if PUBLIC_URL:
        lines += ["", PUBLIC_URL]
    return "\n".join(lines)


def _post(url: str, payload: dict):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req, timeout=15).read()


async def send(text: str, measurement: dict | None = None, profile: dict | None = None,
               analysis: dict | None = None) -> bool:
    """Sends `text`. The webhook also gets the measurement, or the weekly analysis."""
    if not enabled():
        log.info("no notifier configured; message only logged:\n%s", text)
        return False
    ok = True
    if WEBHOOK:
        payload = {"event": "analysis" if analysis else "measurement", "text": text, "message": text,
                   "profile": {k: profile.get(k) for k in ("id", "name")} if profile else None}
        if analysis:
            payload["analysis"] = analysis
        else:
            payload["measurement"] = measurement
        try:
            await asyncio.to_thread(_post, WEBHOOK, payload)
        except OSError as exc:
            log.warning("webhook failed: %s", exc)
            ok = False
    if TELEGRAM_TOKEN and TELEGRAM_CHAT:
        url = f"https://api.telegram.org/bot{urllib.parse.quote(TELEGRAM_TOKEN, safe=':')}/sendMessage"
        try:
            await asyncio.to_thread(_post, url, {"chat_id": TELEGRAM_CHAT, "text": text,
                                                 "disable_web_page_preview": True})
        except OSError as exc:
            log.warning("Telegram failed: %s", exc)
            ok = False
    return ok
