#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <vector>
#include <algorithm>
#include "portal_html.h"

/*
 * Xiaomi Mi Scale 2 BLE Gateway for ESP32 (LOLIN C3 Mini)
 *
 * Scans for the 13-byte broadcast advertisement (UUID 0x181B),
 * extracts the raw hex payload, MAC address, and RSSI, and forwards
 * it over Wi-Fi HTTP POST to the miscale-dashboard server at:
 *   <server>:<port>/api/scale/raw
 *
 * Wi-Fi SSID/password and server/port are configured via a captive portal,
 * stored in flash (NVS), and survive reboots / re-flashing of the sketch.
 *
 * The setup portal starts when:
 *   - no configuration has been saved yet, or
 *   - the saved Wi-Fi network can't be reached at power-on, or
 *   - the config button is pressed 3 times within 2 seconds.
 *
 * Portal: connect your phone to Wi-Fi "MiScale-Setup-XXXX" and the setup
 * page opens automatically (or browse to http://192.168.4.1).
 *
 * No complex calculations are performed on the ESP32.
 */

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

// Config button. GPIO9 = BOOT button on the LOLIN C3 Mini (active LOW).
// Note: don't hold it while powering on, or the chip enters download mode.
static const int           CONFIG_BUTTON_PIN   = 9;
static const int           BUTTON_PRESS_COUNT  = 3;
static const unsigned long BUTTON_WINDOW_MS    = 2000;  // 3 presses within 2 s
static const unsigned long BUTTON_DEBOUNCE_MS  = 40;

// Wi-Fi connection timeout at power-on before falling back to the portal
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;

// If a valid config exists but Wi-Fi was down at boot (e.g. router still
// booting after a power cut), the portal reboots after this much idle time
// (no phone connected) to try the saved network again.
static const unsigned long PORTAL_IDLE_TIMEOUT_MS = 5UL * 60UL * 1000UL;

// Setup access point. Leave password "" for an open AP, or use 8+ characters.
static const char* AP_SSID_PREFIX = "MiScale-Setup-";
static const char* AP_PASSWORD    = "";

// Dashboard API path and default port
static const char*    API_PATH     = "/api/scale/raw";
static const uint16_t DEFAULT_PORT = 8800;

// Some LOLIN C3 Mini boards (v2.1) only connect reliably with reduced TX power.
// Set to 1 if the board fails to join Wi-Fi or the AP is invisible.
#define C3_MINI_REDUCE_TX_POWER 0

// Service UUID for Xiaomi Body Composition Scale 2 (0x181B)
static const uint16_t MI_SCALE_UUID = 0x181B;

// Optional MAC address filter (leave "" to accept ANY Mi Scale in range)
static const char* TARGET_SCALE_MAC = "";

// ---------------------------------------------------------------------------
// PERSISTED SETTINGS
// ---------------------------------------------------------------------------

struct AppConfig {
  String   ssid;
  String   password;
  String   server;   // normalized, e.g. "http://192.168.1.130"
  uint16_t port = DEFAULT_PORT;
};

static AppConfig cfg;
static String    SERVER_URL;   // built at boot: server + ":" + port + API_PATH
static Preferences prefs;

static const char* PREFS_NS = "miscale";

void loadConfig() {
  prefs.begin(PREFS_NS, false);
  cfg.ssid     = prefs.getString("ssid", "");
  cfg.password = prefs.getString("pass", "");
  cfg.server   = prefs.getString("server", "");
  cfg.port     = prefs.getUShort("port", DEFAULT_PORT);
  prefs.end();
}

void saveConfig() {
  prefs.begin(PREFS_NS, false);
  prefs.putString("ssid", cfg.ssid);
  prefs.putString("pass", cfg.password);
  prefs.putString("server", cfg.server);
  prefs.putUShort("port", cfg.port);
  prefs.end();
}

void setForcePortalFlag(bool value) {
  prefs.begin(PREFS_NS, false);
  prefs.putBool("forcePortal", value);
  prefs.end();
}

// Returns true (and clears the flag) if a reboot into the portal was requested
bool consumeForcePortalFlag() {
  prefs.begin(PREFS_NS, false);
  bool forced = prefs.getBool("forcePortal", false);
  if (forced) prefs.putBool("forcePortal", false);
  prefs.end();
  return forced;
}

bool configIsComplete() {
  return cfg.ssid.length() > 0 && cfg.server.length() > 0 && cfg.port > 0;
}

String buildServerUrl() {
  return cfg.server + ":" + String(cfg.port) + API_PATH;
}

// Accepts "192.168.1.130", "http://192.168.1.130", "http://192.168.1.130:8800/x"
// and returns "http://192.168.1.130" (scheme + host only; port comes separately).
String normalizeServer(String s) {
  s.trim();
  String scheme = "http://";
  String lower = s;
  lower.toLowerCase();
  if (lower.startsWith("https://")) {
    scheme = "https://";
    s = s.substring(8);
  } else if (lower.startsWith("http://")) {
    s = s.substring(7);
  }
  int slash = s.indexOf('/');
  if (slash >= 0) s = s.substring(0, slash);
  int colon = s.indexOf(':');
  if (colon >= 0) s = s.substring(0, colon);
  s.trim();
  if (s.length() == 0) return "";
  return scheme + s;
}

void applyTxPower() {
#if C3_MINI_REDUCE_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
}

// ---------------------------------------------------------------------------
// DATA STRUCTURES & QUEUE
// ---------------------------------------------------------------------------

struct ScalePacket {
  char address[18];
  char rawHex[28];
  int rssi;
};

// Explicit prototype (prevents the Arduino IDE from placing an auto-generated
// one above the struct definition)
void sendRawPacketToServer(const ScalePacket& pkt);

static QueueHandle_t packetQueue = nullptr;
static BLEScan* pBLEScan = nullptr;

// Track last sent payload to avoid sending redundant duplicate HTTP requests
static String lastSentPayload = "";
static unsigned long lastSentTime = 0;

static volatile bool portalMode = false;

// ---------------------------------------------------------------------------
// HTTP SENDER TASK (Runs independently so BLE scanner never blocks)
// ---------------------------------------------------------------------------

void sendRawPacketToServer(const ScalePacket& pkt) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Wi-Fi disconnected; packet dropped.");
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2500); // 2.5s network timeout

  // Build JSON: {"address":"XX:XX:XX:XX:XX:XX","raw":"...","rssi":-65}
  char jsonPayload[128];
  snprintf(jsonPayload, sizeof(jsonPayload),
           "{\"address\":\"%s\",\"raw\":\"%s\",\"rssi\":%d}",
           pkt.address, pkt.rawHex, pkt.rssi);

  Serial.println();
  Serial.println("--------------------------------------------------");
  Serial.print("[HTTP POST] "); Serial.println(SERVER_URL);
  Serial.print("Payload    : "); Serial.println(jsonPayload);

  int httpCode = http.POST(jsonPayload);

  if (httpCode > 0) {
    Serial.printf("[HTTP] Success! Server response code: %d\n", httpCode);
    if (httpCode == 200) {
      String response = http.getString();
      Serial.print("[HTTP] Server reply: "); Serial.println(response);
    }
  } else {
    Serial.printf("[HTTP] POST failed, error: %s\n", http.errorToString(httpCode).c_str());
  }
  Serial.println("--------------------------------------------------");

  http.end();
}

void httpSenderTask(void* pvParameters) {
  ScalePacket pkt;
  while (true) {
    if (xQueueReceive(packetQueue, &pkt, portMAX_DELAY) == pdTRUE) {
      sendRawPacketToServer(pkt);
    }
  }
}

// ---------------------------------------------------------------------------
// BUTTON TASK (triple press -> reboot into setup portal)
// Runs in its own task so presses are caught even while BLE scan blocks loop().
// ---------------------------------------------------------------------------

void buttonTask(void* pvParameters) {
  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);

  int lastReading = digitalRead(CONFIG_BUTTON_PIN);
  int stableState = lastReading;
  unsigned long lastChange = 0;
  unsigned long firstPressAt = 0;
  int pressCount = 0;

  for (;;) {
    int reading = digitalRead(CONFIG_BUTTON_PIN);
    unsigned long now = millis();

    if (reading != lastReading) {
      lastReading = reading;
      lastChange = now;
    }

    if ((now - lastChange) > BUTTON_DEBOUNCE_MS && reading != stableState) {
      stableState = reading;

      if (stableState == LOW) {  // button pressed
        if (pressCount == 0 || (now - firstPressAt) > BUTTON_WINDOW_MS) {
          pressCount = 0;
          firstPressAt = now;
        }
        pressCount++;
        Serial.printf("[BTN] Press %d/%d\n", pressCount, BUTTON_PRESS_COUNT);

        if (pressCount >= BUTTON_PRESS_COUNT) {
          pressCount = 0;
          if (!portalMode) {
            Serial.println("[BTN] Triple press -> rebooting into setup portal...");
            setForcePortalFlag(true);
            delay(200);
            ESP.restart();
          } else {
            Serial.println("[BTN] Already in setup portal.");
          }
        }
      }
    }

    if (pressCount > 0 && (now - firstPressAt) > BUTTON_WINDOW_MS) {
      pressCount = 0;
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ---------------------------------------------------------------------------
// CAPTIVE PORTAL
// ---------------------------------------------------------------------------

static WebServer webServer(80);
static DNSServer dnsServer;
static const IPAddress AP_IP(192, 168, 4, 1);

static bool portalCanTimeout = false;
static unsigned long portalLastActivity = 0;
static bool restartPending = false;
static unsigned long restartAt = 0;

struct NetInfo {
  String  ssid;
  int32_t rssi;
  bool    secure;
};
static std::vector<NetInfo> networks;
static bool scanInProgress = false;

// HTML for the setup page lives in portal_html.h

String jsonEscape(const String& in) {
  String out;
  out.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if ((uint8_t)c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", (uint8_t)c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

String htmlEscape(const String& in) {
  String out;
  out.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    switch (c) {
      case '&': out += "&amp;";  break;
      case '<': out += "&lt;";   break;
      case '>': out += "&gt;";   break;
      case '"': out += "&quot;"; break;
      case '\'': out += "&#39;"; break;
      default:  out += c;
    }
  }
  return out;
}

String simplePage(const String& title, const String& bodyHtml) {
  return String("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                "<title>") + title + "</title><style>"
                "body{font-family:-apple-system,system-ui,sans-serif;background:#f4f5f7;padding:16px;color:#222}"
                ".card{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:20px}"
                "code{background:#f4f5f7;padding:2px 4px;border-radius:4px;word-break:break-all}"
                "a{color:#1a73e8}</style></head><body><div class='card'><h2>" + title +
                "</h2>" + bodyHtml + "</div></body></html>";
}

void collectScanResults(int n) {
  networks.clear();
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;  // hidden network
    int32_t rssi = WiFi.RSSI(i);
    bool secure = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;

    bool duplicate = false;
    for (auto& existing : networks) {
      if (existing.ssid == ssid) {
        duplicate = true;
        if (rssi > existing.rssi) {
          existing.rssi = rssi;
          existing.secure = secure;
        }
        break;
      }
    }
    if (!duplicate) networks.push_back({ssid, rssi, secure});
  }
  std::sort(networks.begin(), networks.end(),
            [](const NetInfo& a, const NetInfo& b) { return a.rssi > b.rssi; });
  WiFi.scanDelete();
  Serial.printf("[PORTAL] %u networks found\n", (unsigned)networks.size());
}

void portalTouch() {
  portalLastActivity = millis();
}

void redirectToPortal() {
  portalTouch();
  webServer.sendHeader("Location", String("http://") + AP_IP.toString() + "/", true);
  webServer.send(302, "text/plain", "");
}

void handleRoot() {
  // Requests for other hostnames (captive-portal probes) get redirected
  String host = webServer.hostHeader();
  if (host.length() > 0 && host != AP_IP.toString()) {
    redirectToPortal();
    return;
  }
  portalTouch();
  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send_P(200, "text/html", PORTAL_HTML);
}

void handleConfig() {
  portalTouch();
  // The saved Wi-Fi password is never sent back to the browser.
  String json = "{\"ssid\":\"" + jsonEscape(cfg.ssid) + "\","
                "\"hasPass\":" + String(cfg.password.length() > 0 ? "true" : "false") + ","
                "\"server\":\"" + jsonEscape(cfg.server) + "\","
                "\"port\":" + String(cfg.port) + "}";
  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send(200, "application/json", json);
}

void handleScan() {
  portalTouch();

  if (webServer.hasArg("refresh") && !scanInProgress) {
    WiFi.scanDelete();
    WiFi.scanNetworks(true);  // async, keeps the AP serving
    scanInProgress = true;
  }

  if (scanInProgress) {
    int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING) {
      webServer.send(200, "application/json", "{\"scanning\":true,\"networks\":[]}");
      return;
    }
    scanInProgress = false;
    if (n >= 0) collectScanResults(n);  // on failure keep the previous list
  }

  String json = "{\"scanning\":false,\"networks\":[";
  for (size_t i = 0; i < networks.size(); i++) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + jsonEscape(networks[i].ssid) + "\","
            "\"rssi\":" + String(networks[i].rssi) + ","
            "\"secure\":" + (networks[i].secure ? "true" : "false") + "}";
  }
  json += "]}";
  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send(200, "application/json", json);
}

void handleSave() {
  portalTouch();

  String ssid   = webServer.arg("ssid");
  String pass   = webServer.arg("pass");
  String server = normalizeServer(webServer.arg("server"));
  long   port   = webServer.arg("port").toInt();

  // Blank password + same SSID = keep the saved password
  if (pass.length() == 0 && ssid == cfg.ssid) {
    pass = cfg.password;
  }

  String error;
  if (ssid.length() == 0 || ssid.length() > 32) {
    error = "The network name (SSID) must be 1&ndash;32 characters.";
  } else if (pass.length() > 0 && (pass.length() < 8 || pass.length() > 64)) {
    error = "The Wi-Fi password must be 8&ndash;64 characters (or empty for an open network).";
  } else if (server.length() == 0) {
    error = "The server address is required (e.g. http://192.168.1.130).";
  } else if (port < 1 || port > 65535) {
    error = "The port must be between 1 and 65535.";
  }

  if (error.length() > 0) {
    webServer.send(400, "text/html",
                   simplePage("Check the settings", "<p>" + error + "</p><p><a href='/'>&larr; Back</a></p>"));
    return;
  }

  cfg.ssid     = ssid;
  cfg.password = pass;
  cfg.server   = server;
  cfg.port     = (uint16_t)port;
  saveConfig();

  String url = buildServerUrl();
  Serial.println("[PORTAL] Settings saved:");
  Serial.printf("  SSID      : %s\n", cfg.ssid.c_str());
  Serial.printf("  Server URL: %s\n", url.c_str());

  webServer.send(200, "text/html",
                 simplePage("Saved &#10003;",
                            "<p>The gateway will now reboot and join <b>" + htmlEscape(cfg.ssid) + "</b>.</p>"
                            "<p>Readings will be sent to:<br><code>" + htmlEscape(url) + "</code></p>"
                            "<p>If it can't connect, the <b>" + String(AP_SSID_PREFIX) +
                            "&hellip;</b> network will appear again.</p>"));

  restartPending = true;
  restartAt = millis() + 2000;  // give the browser time to receive the page
}

void startPortal(const char* reason, bool canTimeout) {
  portalMode = true;
  portalCanTimeout = canTimeout;

  Serial.println();
  Serial.println("==================================================");
  Serial.println("   SETUP PORTAL                                   ");
  Serial.println("==================================================");
  Serial.printf("Reason: %s\n", reason);

  // Initial scan in STA mode, before the AP is up
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  applyTxPower();
  Serial.println("[PORTAL] Scanning Wi-Fi networks...");
  int n = WiFi.scanNetworks();
  if (n > 0) collectScanResults(n);

  // Start the access point (AP+STA so we can rescan later)
  WiFi.mode(WIFI_AP_STA);
  applyTxPower();
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  String apSsid = String(AP_SSID_PREFIX) + mac.substring(8);
  bool apOk = WiFi.softAP(apSsid.c_str(), strlen(AP_PASSWORD) >= 8 ? AP_PASSWORD : nullptr);
  delay(100);

  // Answer every DNS query with our IP -> phones show the "sign in" page
  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(53, "*", AP_IP);

  webServer.on("/", HTTP_GET, handleRoot);
  webServer.on("/config", HTTP_GET, handleConfig);
  webServer.on("/scan", HTTP_GET, handleScan);
  webServer.on("/save", HTTP_POST, handleSave);
  // Captive-portal detection URLs (Android, iOS/macOS, Windows)
  webServer.on("/generate_204", redirectToPortal);
  webServer.on("/gen_204", redirectToPortal);
  webServer.on("/hotspot-detect.html", redirectToPortal);
  webServer.on("/library/test/success.html", redirectToPortal);
  webServer.on("/connecttest.txt", redirectToPortal);
  webServer.on("/ncsi.txt", redirectToPortal);
  webServer.on("/fwlink", redirectToPortal);
  webServer.onNotFound(redirectToPortal);
  webServer.begin();

  portalLastActivity = millis();

  Serial.printf("[PORTAL] Access point '%s' %s\n", apSsid.c_str(), apOk ? "started" : "FAILED");
  Serial.printf("[PORTAL] Open http://%s if the page doesn't pop up\n", AP_IP.toString().c_str());
  if (canTimeout) {
    Serial.printf("[PORTAL] Will reboot after %lu min idle to retry saved Wi-Fi\n",
                  PORTAL_IDLE_TIMEOUT_MS / 60000UL);
  }
}

void portalLoop() {
  dnsServer.processNextRequest();
  webServer.handleClient();

  if (WiFi.softAPgetStationNum() > 0) {
    portalLastActivity = millis();
  }

  if (restartPending && (long)(millis() - restartAt) >= 0) {
    Serial.println("[PORTAL] Rebooting with new settings...");
    delay(100);
    ESP.restart();
  }

  if (portalCanTimeout && !restartPending &&
      (millis() - portalLastActivity) > PORTAL_IDLE_TIMEOUT_MS) {
    Serial.println("[PORTAL] Idle timeout, rebooting to retry saved Wi-Fi...");
    delay(100);
    ESP.restart();
  }

  delay(2);
}

// ---------------------------------------------------------------------------
// BLE SCAN CALLBACK
// ---------------------------------------------------------------------------

class ScaleAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    String devAddress = advertisedDevice.getAddress().toString().c_str();
    devAddress.toUpperCase();

    // Check optional MAC filter
    if (strlen(TARGET_SCALE_MAC) > 0) {
      String filterAddress = String(TARGET_SCALE_MAC);
      filterAddress.toUpperCase();
      if (devAddress != filterAddress) {
        return;
      }
    }

    uint8_t scaleData[13];
    bool foundData = false;

    // 1. Direct raw advertisement payload parsing (immune to null bytes in binary data)
    uint8_t* payload = advertisedDevice.getPayload();
    size_t payloadLength = advertisedDevice.getPayloadLength();

    if (payload != nullptr && payloadLength > 0) {
      size_t offset = 0;
      while (offset < payloadLength) {
        uint8_t adLength = payload[offset];
        if (adLength == 0 || (offset + 1 + adLength) > payloadLength) {
          break;
        }
        uint8_t adType = payload[offset + 1];

        // 0x16 = GAP Service Data - 16-bit UUID
        if (adType == 0x16 && adLength >= (1 + 2 + 13)) {
          uint16_t uuid = payload[offset + 2] | (payload[offset + 3] << 8);
          if (uuid == MI_SCALE_UUID) {
            memcpy(scaleData, &payload[offset + 4], 13);
            foundData = true;
            break;
          }
        }
        offset += (1 + adLength);
      }
    }

    // 2. Fallback via standard library service data API
    if (!foundData && advertisedDevice.haveServiceData()) {
      BLEUUID uuid = advertisedDevice.getServiceDataUUID();
      if (uuid.equals(BLEUUID(MI_SCALE_UUID))) {
        auto sData = advertisedDevice.getServiceData();
        if (sData.length() == 13) {
          memcpy(scaleData, (const uint8_t*)sData.c_str(), 13);
          foundData = true;
        }
      }
    }

    if (!foundData) {
      return;
    }

    // Convert raw 13 bytes to uppercase hex string
    char hexBuf[27];
    for (size_t i = 0; i < 13; i++) {
      snprintf(&hexBuf[i * 2], 3, "%02X", scaleData[i]);
    }
    hexBuf[26] = '\0';
    String rawHex = String(hexBuf);

    // Rate-limiting: Only send when raw data changes or at most once every 3s
    unsigned long now = millis();
    if (rawHex == lastSentPayload && (now - lastSentTime < 3000)) {
      return;
    }
    lastSentPayload = rawHex;
    lastSentTime = now;

    // Print summary to Serial Monitor
    Serial.println();
    Serial.println("==================================================");
    Serial.println("   XIAOMI MI SCALE 2 BROADCAST CAPTURED           ");
    Serial.println("==================================================");
    Serial.printf("Device MAC : %s\n", devAddress.c_str());
    Serial.printf("Signal RSSI: %d dBm\n", advertisedDevice.getRSSI());
    Serial.printf("Raw Payload: %s\n", hexBuf);
    Serial.println("==================================================");

    // Queue for sending to HTTP server
    ScalePacket pkt;
    strncpy(pkt.address, devAddress.c_str(), sizeof(pkt.address) - 1);
    pkt.address[sizeof(pkt.address) - 1] = '\0';
    strncpy(pkt.rawHex, hexBuf, sizeof(pkt.rawHex) - 1);
    pkt.rawHex[sizeof(pkt.rawHex) - 1] = '\0';
    pkt.rssi = advertisedDevice.getRSSI();

    xQueueSend(packetQueue, &pkt, 0);
  }
};

// ---------------------------------------------------------------------------
// SETUP & LOOP
// ---------------------------------------------------------------------------

bool connectWiFi() {
  Serial.println();
  Serial.print("Connecting to Wi-Fi '");
  Serial.print(cfg.ssid);
  Serial.print("'");

  WiFi.mode(WIFI_STA);
  applyTxPower();
  WiFi.setAutoReconnect(true);
  WiFi.begin(cfg.ssid.c_str(), cfg.password.length() > 0 ? cfg.password.c_str() : nullptr);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start < WIFI_CONNECT_TIMEOUT_MS)) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" CONNECTED!");
    Serial.print("ESP32 IP Address : ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println(" FAILED");
  return false;
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {
    delay(10);
  }
  delay(500);

  Serial.println();
  Serial.println("==================================================");
  Serial.println("   ESP32 Xiaomi Mi Scale 2 BLE -> HTTP Gateway   ");
  Serial.println("==================================================");

  // Don't let the Wi-Fi driver keep its own copy of credentials;
  // we manage them in Preferences.
  WiFi.persistent(false);

  loadConfig();

  // Button watcher (triple press -> setup portal)
  xTaskCreate(buttonTask, "button", 4096, NULL, 2, NULL);

  if (consumeForcePortalFlag()) {
    startPortal("config button pressed 3 times", configIsComplete());
    return;
  }

  if (!configIsComplete()) {
    startPortal("no saved configuration", false);
    return;
  }

  if (!connectWiFi()) {
    startPortal("could not connect to saved Wi-Fi", true);
    return;
  }

  SERVER_URL = buildServerUrl();
  Serial.print("Target Server URL: ");
  Serial.println(SERVER_URL);

  // Initialize FreeRTOS queue and HTTP sender task
  packetQueue = xQueueCreate(10, sizeof(ScalePacket));
  xTaskCreate(httpSenderTask, "httpSender", 4096, NULL, 1, NULL);

  // Initialize BLE Scanner
  Serial.println("Initializing BLE Scanner...");
  BLEDevice::init("");
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new ScaleAdvertisedDeviceCallbacks(), true);
  pBLEScan->setActiveScan(true);

  // Interval & window tuned for smooth BLE + Wi-Fi coexistence
  pBLEScan->setInterval(160); // 100 ms
  pBLEScan->setWindow(80);    // 50 ms

  Serial.println("Gateway active! Step on the scale to capture & send readings...");
  Serial.printf("(Press the button on GPIO%d 3x to open the setup portal)\n", CONFIG_BUTTON_PIN);
}

void loop() {
  if (portalMode) {
    portalLoop();
    return;
  }

  // Check Wi-Fi connection health
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Wi-Fi] Reconnecting...");
    WiFi.reconnect();
    delay(2000);
  }

  // Scan for 5 seconds (blocking), then clear results to free heap memory
  pBLEScan->start(5, false);
  pBLEScan->clearResults();
  delay(10);
}
