import json
import threading
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import analysis
from tests.test_api import client

ALEX = {"id": 1, "name": "Alex", "height_cm": 178, "birth": "1991-04-13", "male": True}
TEXT = "Your weight went down.\n\nWhat improved\n• Body fat −0.4%\n\nFor next week\n• Weigh in every morning."


def weigh_ins(end: date, days: int = 21) -> list[dict]:
    """One weigh-in a day for `days` days up to `end`, 0.1 kg lighter each day."""
    return [{"measured_at": f"{end - timedelta(days=d)}T07:30:00", "weight_kg": 80 + 0.1 * d, "impedance": 480,
             "metrics": {"body_fat": 24 + 0.05 * d, "muscle_mass": 57.5, "bmi": 25.2}} for d in range(days)]


# ---------- stats() ----------
def test_stats_this_week_previous_and_last_weeks():
    end = date(2026, 10, 10)
    data = analysis.stats(ALEX, weigh_ins(end), end)
    assert data["week"] == {"start": "2026-10-04", "end": "2026-10-10"}
    assert data["person"] == {"name": "Alex", "age": 35, "height_cm": 178, "sex": "male"}
    assert len(data["weigh_ins"]) == 7 and data["weigh_ins"][0]["when"] == "Sun 2026-10-04 07:30"
    assert data["weigh_ins"][-1]["weight"] == 80.0 and data["weigh_ins"][-1]["impedance_ohm"] == 480
    assert data["week_average"]["weigh_ins"] == 7 and data["week_average"]["weight"] == pytest.approx(80.3)
    assert data["previous_week_average"]["weight"] == pytest.approx(81.0)
    assert data["week_average"]["body_fat_pct"] < data["previous_week_average"]["body_fat_pct"]
    # 21 days of data: three weeks out of the last eight, oldest first.
    assert [w["weigh_ins"] for w in data["last_8_weeks"]] == [7, 7, 7]
    assert data["last_8_weeks"][-1]["week"] == "2026-10-04..2026-10-10"


def test_stats_in_pounds_and_with_no_data():
    end = date(2026, 10, 10)
    lb = analysis.stats(ALEX, weigh_ins(end), end, unit="lb")
    assert lb["unit"] == "lb" and lb["weigh_ins"][-1]["weight"] == pytest.approx(176.37, abs=0.01)
    assert lb["weigh_ins"][-1]["body_fat_pct"] == 24.0   # percentages don't change
    empty = analysis.stats({**ALEX, "birth": None}, [], end)
    assert empty["weigh_ins"] == [] and empty["previous_week_average"] is None and empty["last_8_weeks"] == []
    assert empty["person"]["age"] is None


def test_prompt_language():
    data = {"week": {}}
    en, pt = analysis.messages(data, "en"), analysis.messages(data, "pt-BR")
    assert "Write in English" in en[0]["content"] and "What needs attention" in en[0]["content"]
    assert "português do Brasil" in pt[0]["content"] and "O que pede atenção" in pt[0]["content"]
    for msgs in (en, pt):
        assert "not medical advice" in msgs[0]["content"] or "não é orientação médica" in msgs[0]["content"]
        assert json.loads(msgs[1]["content"].split("\n", 1)[1]) == data


def test_language_and_switches(monkeypatch):
    monkeypatch.setattr(analysis, "LANG", "pt-br")
    assert analysis.lang() == "pt-BR"
    monkeypatch.setattr(analysis, "LANG", "en")
    assert analysis.lang() == "en"
    for key, flag, on in (("", "", False), ("sk-x", "", True), ("", "true", True), ("sk-x", "false", False)):
        monkeypatch.setattr(analysis, "API_KEY", key)
        monkeypatch.setattr(analysis, "ENABLED", flag)
        assert analysis.enabled() is on, (key, flag)
    assert analysis._weekday("5") == analysis._weekday("Saturday") == analysis._weekday("sat") == 5
    assert analysis._weekday("0") == analysis._weekday("mon") == 0


def test_clean_drops_markdown():
    text = "## What improved\n• **Body fat** down\n• 2) Water up"
    assert analysis.clean(text) == "What improved\n• Body fat down\n• Water up"


# ---------- Weekly schedule ----------
def test_due_week_end():
    due = analysis.due_week_end
    sat = date(2026, 10, 10)   # a Saturday
    assert due(datetime(2026, 10, 10, 8, 59), 5, 9) is None   # not yet
    assert due(datetime(2026, 10, 10, 9, 0), 5, 9) == sat
    assert due(datetime(2026, 10, 11, 20, 0), 5, 9) == sat     # server was off on Saturday: catches up
    assert due(datetime(2026, 10, 12, 8, 59), 5, 9) == sat
    assert due(datetime(2026, 10, 12, 9, 0), 5, 9) is None     # too late, wait for next week
    assert due(datetime(2026, 10, 9, 23, 0), 5, 9) is None
    assert due(datetime(2026, 10, 12, 7, 0), 0, 6) == date(2026, 10, 12)   # Mondays at 6:00


# ---------- generate() against a fake OpenAI-compatible server ----------
class FakeProvider(BaseHTTPRequestHandler):
    """Behaves by model name: "stream" streams, "json" ignores stream, "strict" rejects it, "down" fails."""
    requests: list[dict] = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeProvider.requests.append({"path": self.path, "auth": self.headers.get("Authorization"), **body})
        model, stream = body["model"], body.get("stream", False)
        if model == "down" or (model == "strict" and stream):
            self.send_response(500 if model == "down" else 400)
            self.end_headers()
            self.wfile.write(b'{"error": {"message": "nope"}}')
            return
        if model == "stream" and stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b": keep-alive\n\n")
            for i in range(0, len(TEXT), 7):
                chunk = {"choices": [{"index": 0, "delta": {"content": TEXT[i:i + 7]}}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b'data: {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}\n\ndata: [DONE]\n\n')
            return
        out = json.dumps({"choices": [{"message": {"role": "assistant", "content": "**" + TEXT + "**"}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


@pytest.fixture
def provider(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeProvider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeProvider.requests = []
    monkeypatch.setattr(analysis, "BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setattr(analysis, "API_KEY", "sk-test")
    monkeypatch.setattr(analysis, "ENABLED", "")
    yield FakeProvider.requests
    server.shutdown()


@pytest.mark.parametrize("model", ["stream", "json", "strict"])
def test_generate_streamed_or_not(provider, monkeypatch, model):
    monkeypatch.setattr(analysis, "MODELS", [model])
    pieces = []
    text, used = analysis.generate({"week": {}}, lambda piece, reset: pieces.append((piece, reset)), "en")
    assert text == TEXT and used == model
    assert "".join(p for p, _ in pieces).strip("*") == TEXT
    assert pieces[0][1] is True and all(not reset for _, reset in pieces[1:])
    if model == "stream":
        assert len(pieces) > 10   # really streamed, piece by piece
    assert provider[0]["path"] == "/v1/chat/completions" and provider[0]["auth"] == "Bearer sk-test"
    assert provider[0]["stream"] is True and provider[0]["messages"][0]["role"] == "system"
    assert [r.get("stream", False) for r in provider] == ([True, False] if model == "strict" else [True])


def test_generate_without_streaming_and_model_fallback(provider, monkeypatch):
    monkeypatch.setattr(analysis, "MODELS", ["down", "json"])
    assert analysis.generate({"week": {}}) == (TEXT, "json")
    assert [r["model"] for r in provider] == ["down", "json"] and "stream" not in provider[1]
    monkeypatch.setattr(analysis, "MODELS", ["down"])
    with pytest.raises(RuntimeError, match="down"):
        analysis.generate({"week": {}})


def test_no_key_sends_no_authorization(provider, monkeypatch):
    # A local Ollama: MISCALE_AI_ENABLED=true and no key.
    monkeypatch.setattr(analysis, "API_KEY", "")
    monkeypatch.setattr(analysis, "ENABLED", "true")
    monkeypatch.setattr(analysis, "MODELS", ["json"])
    assert analysis.generate({"week": {}})[0] == TEXT
    assert provider[0]["auth"] is None


# ---------- API ----------
def add_week(main, pid):
    for m in weigh_ins(date.today(), 10):
        main.db.insert({**m, "profile_id": pid})


def test_api_when_ai_is_off(tmp_path, monkeypatch):
    monkeypatch.setattr(analysis, "API_KEY", "")
    monkeypatch.setattr(analysis, "ENABLED", "")
    c, main = client(tmp_path)
    with c:
        assert c.get("/api/settings").json()["ai_enabled"] is False
        p = c.post("/api/profiles", json={"name": "Alex", "height_cm": 178, "birth": "1991-04-13"}).json()
        add_week(main, p["id"])
        r = c.post(f"/api/analyses/run?profile_id={p['id']}")
        assert r.status_code == 503 and "MISCALE_AI_API_KEY" in r.json()["detail"]
        assert c.get("/api/analyses").json() == []


def test_api_streams_and_saves_the_analysis(tmp_path, provider, monkeypatch):
    monkeypatch.setattr(analysis, "MODELS", ["stream"])
    monkeypatch.setattr(analysis, "LANG", "pt-BR")
    c, main = client(tmp_path)
    with c, c.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "status"
        s = c.get("/api/settings").json()
        assert s["ai_enabled"] is True and 0 <= s["ai_weekday"] <= 6 and 0 <= s["ai_hour"] <= 23
        p = c.post("/api/profiles", json={"name": "Alex", "height_cm": 178, "birth": "1991-04-13"}).json()
        sam = c.post("/api/profiles", json={"name": "Sam"}).json()
        # Nobody weighed in during the last 7 days: nothing to analyze.
        r = c.post(f"/api/analyses/run?profile_id={sam['id']}")
        assert r.status_code == 409 and r.json()["detail"] == main.NO_WEIGH_INS
        assert c.post("/api/analyses/run?profile_id=999").status_code == 404

        add_week(main, p["id"])
        r = c.post(f"/api/analyses/run?profile_id={p['id']}")
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["text"] == TEXT and a["model"] == "stream" and a["kind"] == "manual" and a["lang"] == "pt-BR"
        assert a["week_end"] == date.today().isoformat()
        assert c.get(f"/api/analyses?profile_id={p['id']}&limit=1").json() == [a]
        assert c.get(f"/api/analyses?profile_id={sam['id']}").json() == []
        # The prompt carried this week's numbers.
        sent = json.loads(provider[-1]["messages"][1]["content"].split("\n", 1)[1])
        assert sent["person"]["name"] == "Alex" and sent["week_average"]["weigh_ins"] == 7

        msgs = [ws.receive_json()]
        while msgs[-1]["type"] != "analysis":
            msgs.append(ws.receive_json())
        assert msgs[0] == {"type": "analysis_start", "profile_id": p["id"]}
        deltas = [m for m in msgs if m["type"] == "analysis_delta"]
        assert len(deltas) > 10 and deltas[0]["reset"] and "".join(d["text"] for d in deltas) == TEXT
        assert msgs[-1] == {"type": "analysis", "profile_id": p["id"], "analysis": a}


def test_api_reports_provider_failure(tmp_path, provider, monkeypatch):
    monkeypatch.setattr(analysis, "MODELS", ["down"])
    c, main = client(tmp_path)
    with c:
        p = c.post("/api/profiles", json={"name": "Alex"}).json()
        add_week(main, p["id"])
        r = c.post(f"/api/analyses/run?profile_id={p['id']}")
        assert r.status_code == 502 and "down" in r.json()["detail"]
        assert main.writing == set()


def test_weekly_analysis_is_notified(tmp_path, provider, monkeypatch):
    monkeypatch.setattr(analysis, "MODELS", ["json"])
    c, main = client(tmp_path)
    sent = []

    async def fake_send(text, measurement=None, profile=None, analysis=None):
        sent.append((text, profile["name"], analysis["kind"]))
        return True

    monkeypatch.setattr(main.notify, "enabled", lambda: True)
    monkeypatch.setattr(main.notify, "send", fake_send)
    with c:
        p = c.post("/api/profiles", json={"name": "Alex"}).json()
        add_week(main, p["id"])
        c.portal.call(main.run_analysis, p["id"], date.today(), "weekly", True)
        assert main.db.has_weekly(p["id"], date.today().isoformat())
    assert len(sent) == 1 and sent[0][1:] == ("Alex", "weekly") and TEXT in sent[0][0]
