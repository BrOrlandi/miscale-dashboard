# ESP32 Xiaomi Mi Scale 2 BLE Gateway

This firmware turns an ESP32 (such as the **LOLIN C3 Mini**, ESP32 DevKit, etc.) into an autonomous **Bluetooth Low Energy (BLE) to Wi-Fi gateway** for [**Mi Scale Dashboard**](../README.md).

It listens for the 13-byte broadcast advertisements from the **Xiaomi Mi Body Composition Scale 2 (XMTZC05HM)** without requiring connection or pairing, extracts the raw broadcast packet, and forwards it over your local network via HTTP POST to the dashboard server running on port `8800`.

---

## Features

- **No Bluetooth required on the server:** The server running `miscale-dashboard` can be placed anywhere on your local network (NAS in a rack, Docker container, VM, Windows, macOS, or Linux) without needing host Bluetooth hardware or `/run/dbus` permissions.
- **On-Demand Captive Portal (`MiScale-Setup-XXXX`):** An integrated setup access point lets you configure your network settings from your phone or laptop with no hardcoded credentials.
- **Hardware Button Trigger:** Press the board's config button (**GPIO 9 / BOOT button**) **3 times within 2 seconds** at any time to re-enter setup mode without needing to re-flash.
- **Auto-Recovery on Power Outages:** If Wi-Fi was temporarily down when the gateway booted (e.g., router still starting up after a power cut), the portal automatically reboots after 5 minutes of idle time to retry connecting to the saved network.
- **Persistent NVS Flash Storage:** All settings are saved using native ESP32 `Preferences` in flash and survive reboots and sketch updates.
- **Zero Third-Party Dependencies:** Built using native Arduino-ESP32 core libraries (`WiFi`, `WebServer`, `DNSServer`, `Preferences`, `HTTPClient`, `BLEDevice`).
- **FreeRTOS Task Isolation:** The BLE scanner and HTTP client run in separate FreeRTOS tasks connected by an asynchronous queue, ensuring zero dropped packets and no watchdog resets.

---

## Project Structure

```text
esp32/
  platformio.ini
  README.md
  miscale_reader/
    miscale_reader.ino    Main application (BLE scanner, Wi-Fi, HTTP client, button watcher)
    portal_html.h         PROGMEM HTML/CSS/JS for the captive portal setup page
```

---

## Setup & Captive Portal

### When does the portal start?
1. On the very first boot (when no configuration exists yet).
2. When the gateway fails to connect to the saved Wi-Fi within 20 seconds.
3. When the config button (**GPIO 9 / BOOT**) is pressed **3 times within 2 seconds**.

### How to configure:
1. Connect your phone or computer to the Wi-Fi hotspot:
   - **SSID:** `MiScale-Setup-XXXX` *(where `XXXX` corresponds to the last 4 characters of the ESP32's MAC address)*
   - **Password:** *(None / Open)*
2. The setup page opens automatically *(or open your browser to `http://192.168.4.1/`)*.
3. Configure the parameters:
   - **Wi-Fi networks:** Select a detected network from the list (with real-time signal strength bars `▂▄▆█` and `🔒` encryption flags), or type the SSID manually.
   - **Password:** Enter your network password (includes a "Show password" toggle). If modifying other settings, leave the password blank to keep the existing saved password.
   - **Server:** Enter the server IP address or hostname (e.g. `http://192.168.1.130`).
   - **Port:** Enter the dashboard port (default: `8800`).
   - A live preview displays the exact target endpoint: `POST → http://192.168.1.130:8800/api/scale/raw`.
4. Tap **Save & reboot**. The board saves your settings to non-volatile storage, restarts, and connects to your network.

---

## Flashing Instructions

### Option A: Arduino IDE (Recommended)

1. Open Arduino IDE and install the **esp32** board package by Espressif Systems (**Tools > Board > Boards Manager**, version 2.x or 3.x).
2. Open [`miscale_reader/miscale_reader.ino`](miscale_reader/miscale_reader.ino).
3. Select your board (e.g. **LOLIN C3 Mini** or **ESP32 Dev Module**) and the appropriate COM port.
4. Configure the board options:
   - **Tools > Partition Scheme:** Select **Huge APP (3MB No OTA / 1MB SPIFFS)**.
     > **Tip:** If the partition is too small for the firmware (giving a `sketch too big` or partition overflow error), you can change the partition size by not using OTA (Over-The-Air updates). In Arduino IDE, go to **Tools → Partition Scheme** and choose **Huge APP (3MB No OTA/1MB SPIFFS)**, which is the simplest choice with lots of headroom (~3MB for application code).
   - **Tools > USB CDC On Boot:** **Enabled** *(default for ESP32-C3)*.
5. Click **Upload**.
6. Open the **Serial Monitor** at **115200 baud** to view real-time diagnostics.

### Option B: PlatformIO

From the `esp32` directory:

```bash
pio run --target upload && pio device monitor -b 115200
```

*(Note: `platformio.ini` is already configured with `board_build.partitions = huge_app.csv`)*.

---

## Hardware Notes & Troubleshooting

- **Partition Too Small / `Sketch too big` Error:** The default ESP32 partition table splits flash in half to reserve space for OTA updates (leaving only ~1.2MB for code). Because combining the BLE scanner and Wi-Fi/HTTP stack requires ~1.4MB, compilation or flashing will fail if using the default partition. Resolve this by switching to a non-OTA scheme: in Arduino IDE, go to **Tools → Partition Scheme** and pick **Huge APP (3MB No OTA/1MB SPIFFS)**, which provides plenty of headroom.
- **LOLIN C3 Mini Button:** The `CONFIG_BUTTON_PIN` defaults to **GPIO 9** (the onboard `BOOT` button). Do not hold this button while powering on the board, as doing so puts the ESP32-C3 into ROM download mode.
- **LOLIN C3 Mini v2.1 Wi-Fi Sensitivity:** Some revisions of the LOLIN C3 Mini (v2.1) connect more reliably with reduced transmit power. If your board struggles to join Wi-Fi or the setup AP is intermittent, set `#define C3_MINI_REDUCE_TX_POWER 1` near the top of [`miscale_reader.ino`](miscale_reader/miscale_reader.ino) to limit TX power to 8.5 dBm.
- **Server Ingestion:** The ESP32 dispatches packets to `POST /api/scale/raw`. Ensure your `miscale-dashboard` server is running and reachable on port `8800` from your local network.
