"""Optional weekly analysis of a profile's trends, written by a language model."""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import date, datetime, timedelta

log = logging.getLogger("yunmai.analysis")

API_KEY = (os.environ.get("YUNMAI_AI_API_KEY") or os.environ.get("MISCALE_AI_API_KEY", "")).strip()
BASE_URL = (os.environ.get("YUNMAI_AI_BASE_URL") or os.environ.get("MISCALE_AI_BASE_URL", "")).strip() or "https://api.openai.com/v1"
BASE_URL = BASE_URL.rstrip("/")
DEFAULT_MODEL = "gpt-5.4-mini"
MODELS = [m.strip() for m in ((os.environ.get("YUNMAI_AI_MODEL") or os.environ.get("MISCALE_AI_MODEL", "")).strip() or DEFAULT_MODEL).split(",") if m.strip()]
ENABLED = (os.environ.get("YUNMAI_AI_ENABLED") or os.environ.get("MISCALE_AI_ENABLED", "")).strip().lower()
LANG = (os.environ.get("YUNMAI_AI_LANG") or os.environ.get("MISCALE_AI_LANG", "")).strip() or (os.environ.get("YUNMAI_LANG") or os.environ.get("MISCALE_LANG", "en"))
TIMEOUT = 180
LB = 0.45359237

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _weekday(value: str) -> int:
    """0 = Monday ... 6 = Sunday; also accepts a day name ("sat", "saturday")."""
    v = value.strip().lower()
    if v.isdigit():
        return int(v) % 7
    return next((i for i, d in enumerate(WEEKDAYS) if v and d.startswith(v[:3])), 5)


WEEKDAY = _weekday(os.environ.get("YUNMAI_AI_WEEKDAY") or os.environ.get("MISCALE_AI_WEEKDAY", "5"))
HOUR = min(max(int(os.environ.get("YUNMAI_AI_HOUR") or os.environ.get("MISCALE_AI_HOUR", "9") or 9), 0), 23)


def enabled() -> bool:
    if ENABLED in ("1", "true", "yes", "on"):
        return True
    if ENABLED in ("0", "false", "no", "off"):
        return False
    return bool(API_KEY)


def lang() -> str:
    if LANG.lower().startswith("es"):
        return "es"
    if LANG.lower().startswith("pt"):
        return "pt-BR"
    return "en"


# ---------- Prompt ----------
SYSTEM = {
    "en": """You are a friendly, down-to-earth health coach. You read one person's data from a
bioimpedance scale (Yunmai Smart Scale) and write their weekly summary. You
only know these numbers: nothing about their training, sleep or food.

Write in English, speaking to the person ("you"). Rules:
- Plain text only: no markdown, no asterisks, no hash signs, no tables. Bullets start with
  "• " and are not numbered.
- Start with 2 or 3 sentences summing up the week: what changed in weight and body composition.
- Then the sections "What improved" and "What needs attention", each title on its own line
  with no colon, followed by up to 3 short bullets with numbers.
- End with the section "For next week" and 2 or 3 practical, general suggestions (weigh-in
  routine, activity, protein, water, sleep).
- Bioimpedance shifts with hydration, meals and time of day: look at averages and trends over
  the weeks, never at a single day. If there are few weigh-ins this week, or nothing to
  compare with, say so and suggest weighing every day at the same time (in the morning,
  before eating, barefoot).
- This is not medical advice: don't diagnose, don't name conditions or medication, and
  suggest a professional only if something looks unusual.
- Use the unit in the data. At most about 1200 characters. No greeting and no sign-off.""",
    "es": """Eres un entrenador de salud cercano y práctico. Lees los datos de una persona obtenidos
de una báscula de bioimpedancia (Báscula Inteligente Yunmai) y escribes su resumen semanal. Solo
conoces estos números: nada sobre sus entrenamientos, sueño o comidas.

Escribe en español, dirigiéndote a la persona ("tú"). Reglas:
- Solo texto plano: nada de markdown, asteriscos, almohadillas ni tablas. Las viñetas empiezan con
  "• " y no van numeradas.
- Comienza con 2 o 3 frases resumiendo la semana: qué cambió en peso y composición corporal.
- Luego las secciones "Lo que mejoró" y "A prestar atención", cada título en su propia línea
  sin dos puntos, seguido de hasta 3 viñetas cortas con números.
- Termina con la sección "Para la próxima semana" y 2 o 3 sugerencias prácticas y generales (rutina
  de pesaje, actividad, proteína, agua, descanso).
- La bioimpedancia fluctúa con hidratación, digestión y hora: analiza promedios y tendencias semanales,
  nunca un único día aislado. Si hubo pocos pesajes esta semana, indícalo y sugiere pesarse a diario
  a la misma hora (por la mañana, en ayunas, descalzo).
- Esto no es consejo médico: no diagnostiques ni prescribas.
- Usa la unidad de los datos. Máximo unos 1200 caracteres. Sin saludos ni despedidas.""",
    "pt-BR": """Você é um coach de saúde amigável e direto. Você lê os dados de uma pessoa numa
balança de bioimpedância (Balança Inteligente Yunmai) e escreve o resumo da semana
dela. Você só conhece esses números: nada sobre treino, sono ou alimentação.

Escreva em português do Brasil, falando com a pessoa ("você"). Regras:
- Só texto puro: nada de markdown, asterisco, cerquilha ou tabela. Itens de lista começam
  com "• " e não são numerados.
- Comece com 2 ou 3 frases de resumo da semana: o que mudou no peso e na composição.
- Depois as seções "O que melhorou" e "O que pede atenção", cada título sozinho na linha e
  sem dois-pontos, seguido de até 3 itens curtos com números.
- Termine com a seção "Para a próxima semana" e 2 ou 3 sugestões práticas e gerais (rotina de
  pesagem, atividade física, proteína, água, sono).
- A bioimpedância varia com hidratação, refeição e horário: olhe médias e a tendência das
  semanas, nunca um dia isolado. Se a semana tiver poucas pesagens, ou nada para comparar,
  diga isso e sugira pesar todo dia no mesmo horário (de manhã, em jejum, descalço).
- Isto não é orientação médica: não faça diagnóstico, não cite doenças nem remédios e só
  sugira um profissional se algo parecer fora do normal.
- Use a unidade dos dados. No máximo uns 1200 caracteres. Sem saudação e sem despedida.""",
}

USER = {
    "en": "Scale data for the week (JSON):\n",
    "es": "Datos de la báscula durante la semana (JSON):\n",
    "pt-BR": "Dados da balança na semana (JSON):\n",
}


def messages(data: dict, language: str | None = None) -> list[dict]:
    language = language or lang()
    sys_content = SYSTEM.get(language, SYSTEM["en"])
    usr_prefix = USER.get(language, USER["en"])
    return [
        {"role": "system", "content": sys_content},
        {"role": "user", "content": usr_prefix + json.dumps(data, ensure_ascii=False, indent=1)},
    ]


# ---------- Numbers sent to the model ----------
FIELDS = [
    ("weight", True), ("bmi", False), ("body_fat_pct", False), ("fat_mass", True), ("muscle_mass", True),
    ("water_pct", False), ("protein_pct", False), ("bone_mass", True), ("visceral_fat", False), ("bmr_kcal", False),
]
SOURCE = {"weight": "weight_kg", "body_fat_pct": "body_fat", "water_pct": "water", "protein_pct": "protein",
          "bmr_kcal": "bmr"}


def _get(m: dict, field: str, unit: str):
    key = SOURCE.get(field, field)
    v = m["weight_kg"] if key == "weight_kg" else (m.get("metrics") or {}).get(key)
    if v is None:
        return None
    if unit == "lb" and dict(FIELDS)[field]:
        v = v / LB
    return round(v, 2)


def _avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 1) if values else None


def week_bounds(week_end: date) -> tuple[date, date]:
    """The 7 days that end on `week_end`."""
    return week_end - timedelta(days=6), week_end


def stats(profile: dict, measurements: list[dict], week_end: date, unit: str = "kg") -> dict:
    unit = "lb" if unit == "lb" else "kg"

    def between(a: date, b: date) -> list[dict]:
        return sorted((m for m in measurements if a <= datetime.fromisoformat(m["measured_at"]).date() <= b),
                      key=lambda m: m["measured_at"])

    def summary(ms: list[dict]) -> dict:
        return {"weigh_ins": len(ms), **{f: _avg([_get(m, f, unit) for m in ms]) for f, _ in FIELDS}}

    start, end = week_bounds(week_end)
    week = between(start, end)
    prev = between(start - timedelta(days=7), start - timedelta(days=1))
    weeks = []
    for i in range(7, -1, -1):
        b = end - timedelta(days=7 * i)
        a = b - timedelta(days=6)
        ms = between(a, b)
        if ms:
            weeks.append({"week": f"{a.isoformat()}..{b.isoformat()}", "weigh_ins": len(ms),
                          "weight": _avg([_get(m, "weight", unit) for m in ms]),
                          "body_fat_pct": _avg([_get(m, "body_fat_pct", unit) for m in ms]),
                          "muscle_mass": _avg([_get(m, "muscle_mass", unit) for m in ms])})

    age = None
    if profile.get("birth"):
        b = date.fromisoformat(profile["birth"])
        age = end.year - b.year - ((end.month, end.day) < (b.month, b.day))
    return {
        "person": {"name": profile["name"], "age": age, "height_cm": profile.get("height_cm"),
                   "sex": "male" if profile.get("male") else "female"},
        "unit": unit,
        "week": {"start": start.isoformat(), "end": end.isoformat()},
        "weigh_ins": [{"when": datetime.fromisoformat(m["measured_at"]).strftime("%a %Y-%m-%d %H:%M"),
                       **{f: _get(m, f, unit) for f, _ in FIELDS}, "impedance_ohm": m.get("impedance")}
                      for m in week],
        "week_average": summary(week),
        "previous_week_average": summary(prev) if prev else None,
        "last_8_weeks": weeks,
    }


def due_week_end(now: datetime, weekday: int = WEEKDAY, hour: int = HOUR, grace_days: int = 2) -> date | None:
    day = now.date() - timedelta(days=(now.weekday() - weekday) % 7)
    due = datetime.combine(day, datetime.min.time()) + timedelta(hours=hour)
    if now < due:
        day -= timedelta(days=7)
        due -= timedelta(days=7)
    return day if due <= now < due + timedelta(days=grace_days) else None


def clean(text: str) -> str:
    lines = []
    for line in text.strip().splitlines():
        line = re.sub(r"^(\s*[•\-*]\s+)\d+[.)]\s+", r"\1", line.replace("**", "").replace("__", ""))
        lines.append(line.lstrip().lstrip("#").strip() if line.lstrip().startswith("#") else line.rstrip())
    return "\n".join(lines).strip()


def _request(model: str, msgs: list[dict], stream: bool) -> urllib.request.Request:
    body = {"model": model, "messages": msgs}
    if stream:
        body["stream"] = True
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream" if stream else "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    return urllib.request.Request(f"{BASE_URL}/chat/completions", data=json.dumps(body).encode(),
                                  headers=headers, method="POST")


def _content(data: dict) -> str:
    return data["choices"][0]["message"]["content"] or ""


def chat(model: str, msgs: list[dict], on_delta: Callable[[str], None] | None = None) -> str:
    if on_delta is None:
        with urllib.request.urlopen(_request(model, msgs, False), timeout=TIMEOUT) as r:
            return _content(json.load(r))
    try:
        r = urllib.request.urlopen(_request(model, msgs, True), timeout=TIMEOUT)
    except urllib.error.HTTPError as exc:
        if exc.code not in (400, 415, 422, 501):
            raise
        log.info("%s rejected a streamed request (%s); asking again without streaming", model, exc.code)
        text = chat(model, msgs)
        on_delta(text)
        return text
    with r:
        if "text/event-stream" not in r.headers.get("Content-Type", ""):
            text = _content(json.load(r))
            on_delta(text)
            return text
        parts = []
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            chunk = json.loads(payload)
            if chunk.get("error"):
                raise ValueError(str(chunk["error"])[:300])
            for choice in chunk.get("choices") or []:
                piece = (choice.get("delta") or {}).get("content")
                if piece:
                    parts.append(piece)
                    on_delta(piece)
        return "".join(parts)


def generate(data: dict, on_delta: Callable[[str, bool], None] | None = None,
             language: str | None = None) -> tuple[str, str]:
    msgs = messages(data, language)
    errors = []
    for model in MODELS:
        first = True

        def delta(piece: str):
            nonlocal first
            if on_delta:
                on_delta(piece, first)
            first = False

        try:
            text = clean(chat(model, msgs, delta if on_delta else None))
            if text:
                return text, model
            errors.append(f"{model}: empty answer")
        except (urllib.error.URLError, OSError, KeyError, IndexError, TypeError, ValueError) as exc:
            detail = exc.read().decode("utf-8", "replace")[:300] if isinstance(exc, urllib.error.HTTPError) else str(exc)
            log.warning("model %s failed: %s", model, detail)
            errors.append(f"{model}: {detail}")
    raise RuntimeError("; ".join(errors) or "no model configured (YUNMAI_AI_MODEL)")
