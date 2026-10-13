# Yunmai Scale Dashboard ⚖️

Live weigh-ins, body composition and history for **Yunmai** smart scales.

Adapted from the excellent [miscale-dashboard](https://github.com/BrOrlandi/miscale-dashboard) by Bruno Orlandi, preserving the entire web interface, real-time animations, PWA support, charts, profiles, and optional AI weekly analysis, while replacing the BLE communication layer and body metrics calculations with the **Yunmai BLE protocol** (reverse-engineered directly from Yunmai firmware & app).

---

## 🌟 Features

- **Real-time Live Weigh-ins:** As soon as you step on the scale, the dashboard shows the settling weight in real time with smooth animations and impedance stabilization.
- **Full Bioimpedance Metrics:** Body fat %, muscle mass, bone mass, water %, protein %, BMI, visceral fat, lean body mass, and BMR calculated using native Yunmai formulas.
- **Multi-user with Automatic Matching:** Detects who is on the scale based on recent weight history (or reference weight). Unknown weights can be easily assigned in the history.
- **Dual-mode Yunmai BLE Protocol:**
  - **Broadcast Mode (Advertising / Connectionless):** Passive decoding for broadcast-capable Yunmai scales (e.g. Yunmai X, Color 2, etc.).
  - **GATT Connected Mode:** Automatic connection and notification subscription on service `0xFFE0` / `0xFFE4` for GATT models (Yunmai Mini, SE, Premium, etc.).
- **Self-Hosted & Private:** All data stays on your local SQLite database (`yunmai.db`).
- **Responsive PWA:** Works on mobile and desktop, installable as a Progressive Web App, with dark and light themes.
- **Notifications & AI Summary (Optional):** Webhook/Telegram notifications and weekly AI summaries (compatible with local Ollama, OpenAI, or OpenRouter).

---

## 🚀 Quick Start with Docker

```bash
docker compose up -d
```

The dashboard will be available at [http://localhost:8800](http://localhost:8800).

> **Note on Linux / Raspberry Pi / Docker:**
> The BLE scanner communicates with the host Bluetooth controller (BlueZ) via the system D-Bus. `docker-compose.yml` mounts `/run/dbus:/run/dbus:ro` with `apparmor=unconfined`.

---

## 🐍 Native Run with Python

1. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the server:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8800
   ```
3. Open `http://localhost:8800` in your browser.

---

## ⚙️ Configuration (`.env`)

Copy `.env.example` to `.env` to customize settings:

| Variable | Default | Description |
|---|---|---|
| `YUNMAI_SCALE_MAC` | *(empty)* | Lock to a specific Bluetooth MAC address. If empty, accepts any Yunmai scale nearby. |
| `YUNMAI_LANG` | `es` | Notification language: `es`, `en`, or `pt-BR`. Web UI follows browser language. |
| `YUNMAI_SCANNER` | `on` | Set to `off` to disable the BLE scanner (e.g. for testing with simulation only). |
| `YUNMAI_DB` | `/data/yunmai.db` | Path to the SQLite database file. |
| `YUNMAI_PUBLIC_URL` | *(empty)* | Public URL appended to notifications. |
| `YUNMAI_WEBHOOK_URL`| *(empty)* | Optional HTTP webhook URL called on every new weigh-in. |
| `YUNMAI_TELEGRAM_TOKEN` | *(empty)* | Telegram bot token for weigh-in alerts. |
| `YUNMAI_TELEGRAM_CHAT_ID` | *(empty)* | Telegram chat ID for weigh-in alerts. |
| `YUNMAI_AI_API_KEY` | *(empty)* | Optional API key for weekly AI summary (OpenAI, OpenRouter, etc.). |
| `YUNMAI_AI_BASE_URL` | `https://api.openai.com/v1` | AI endpoint (e.g. `http://localhost:11434/v1` for local Ollama). |
| `YUNMAI_AI_ENABLED` | *(empty)* | Set to `true` for keyless local AI servers like Ollama. |

---

## 🧪 Testing and Simulation

- **Simulate a weigh-in:** Click the test weigh-in simulation button in the web settings or send a POST request:
  ```bash
  curl -X POST "http://localhost:8800/api/debug/simulate?weight=75.5&impedance=490"
  ```
- **Inspect discovered Bluetooth devices:** Check [http://localhost:8800/api/debug/devices](http://localhost:8800/api/debug/devices) to find the MAC address of your scale.
- **Run the test suite:**
  ```bash
  python run_tests.py
  ```

---

## 📜 Credits & License

- UI, design, and architecture based on [miscale-dashboard](https://github.com/BrOrlandi/miscale-dashboard) by [Bruno Orlandi](https://github.com/BrOrlandi) (MIT License).
- Yunmai Bluetooth protocol reverse-engineered from Yunmai firmware, Android APK, and the open-source [openScale](https://github.com/oliexdev/openScale) project.
