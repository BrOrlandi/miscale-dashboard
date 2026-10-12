# Contributing

Thanks for helping. The project stays deliberately small: one Python service, one HTML file,
SQLite and no build step. Please keep it that way. Whatever you change has to run on a
Raspberry Pi.

## Getting started

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m scripts.seed_demo data/demo.db
MISCALE_DB=data/demo.db MISCALE_SCANNER=off uvicorn app.main:app --reload --port 8800
curl -X POST 'localhost:8800/api/debug/simulate?weight=81.4&impedance=478'
```

Before opening a pull request:

```bash
pytest
ruff check .
```

## Guidelines

- **Tests for parsing and measurement logic.** If you touch `scale.py`, `session.py` or
  `body.py`, add a test with real packets (`tests/packets.py` builds them).
- **UI text goes through the translations.** Add new strings to both `en` and `pt-BR` in
  `STRINGS` (`app/static/index.html`). New languages are welcome.
- **Weights are stored in kg.** Convert only for display.
- **No new runtime dependencies** without a good reason; open an issue first.
- **Respect `prefers-reduced-motion`** for any new animation.

## Adding another scale

Most of the work is in `app/scale.py`. A new model needs a parser that turns its
advertisement (or GATT notification) into a `Reading`. Include in the pull request:

- the model name and number, plus a photo of the label if possible;
- raw packets from a real weigh-in (`/api/debug/packets` or `/api/debug/devices`);
- tests built from those packets.

## Reporting bugs

Use the issue templates. For problems with readings, include your scale model, Bluetooth
adapter, OS, and the output of `/api/debug/packets` right after a weigh-in.
