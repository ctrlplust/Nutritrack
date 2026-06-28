#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "HX711.h"

// ─────────────────────────────────────────
//  ⚙️  CONFIGURACIÓN — Editá esp32/config.h
// ─────────────────────────────────────────
#include "config.h"

#define READING_URL       SERVER_BASE "/reading"
#define ACTIVE_URL        SERVER_BASE "/active"

// Pines
#define LOADCELL_DOUT_PIN  32
#define LOADCELL_SCK_PIN   33

// Balanza
#define FACTOR_CALIBRACION  -445.24
#define UMBRAL_PESO          10.0
#define MUESTRAS             10
#define TOLERANCIA_DELTA      5.0

enum Estado {
  IDLE,
  ESPERANDO_PRODUCTO,
  ESPERANDO_RETIRO,
  ESPERANDO_DEVOLUCION,
};

HX711  balanza;
Estado estado      = IDLE;
float  peso_inicial = 0;
float  peso_final   = 0;

// Lo que la app escaneó (se refresca desde /active)
String activeBarcode    = "";
String activeProductName = "";

unsigned long lastPoll = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("=== NutriTrack Scale ===");

  balanza.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  balanza.set_scale(FACTOR_CALIBRACION);
  balanza.tare();
  Serial.println("Scale ready");

  connectWiFi();
  Serial.println("Waiting: scan from app or press 'S'...");
}

float readWeight() {
  return balanza.get_units(MUESTRAS);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  switch (estado) {

    case IDLE:
      if (millis() - lastPoll >= 3000) {
        lastPoll = millis();
        String barcode, name;
        bool hasActive = fetchActiveProduct(barcode, name);
        if (hasActive) {
          activeBarcode = barcode;
          activeProductName = name;
          Serial.printf("Scan detected: %s\n", name.c_str());
          Serial.println("Place product on the scale");
          estado = ESPERANDO_PRODUCTO;
        }
      }
      if (Serial.available() > 0 && Serial.read() == 'S') {
        Serial.println("Manual start — place product on scale");
        estado = ESPERANDO_PRODUCTO;
      }
      break;

    case ESPERANDO_PRODUCTO: {
      float w = readWeight();
      if (w > UMBRAL_PESO) {
        Serial.println("Product detected, stabilizing...");
        delay(2000);
        peso_inicial = readWeight();
        Serial.printf("Initial weight: %.1f g\n", peso_inicial);
        Serial.println("Remove product, serve, then return it");
        estado = ESPERANDO_RETIRO;
      }
      break;
    }

    case ESPERANDO_RETIRO: {
      float w = readWeight();
      if (w < UMBRAL_PESO) {
        Serial.println("Product removed, waiting for return...");
        delay(500);
        estado = ESPERANDO_DEVOLUCION;
      }
      break;
    }

    case ESPERANDO_DEVOLUCION: {
      float w = readWeight();
      if (w > UMBRAL_PESO) {
        Serial.println("Product returned, stabilizing...");
        delay(2000);
        peso_final = readWeight();
        float delta = peso_inicial - peso_final;

        Serial.printf("Initial: %.1f g  Final: %.1f g  Delta: %.1f g\n",
          peso_inicial, peso_final, delta);

        if (delta >= TOLERANCIA_DELTA) {
        // Send reading with product info captured at cycle start
        sendReading(delta, peso_final, peso_inicial);
        } else {
          Serial.println("Delta too small, skipped");
        }

        Serial.println("Ready for next cycle");
        estado = IDLE;
      }
      break;
    }
  }
}

// ─────────────────────────────────────────
//  GET /active — returns product barcode & name
//  Returns false if no active product
// ─────────────────────────────────────────
bool fetchActiveProduct(String &outBarcode, String &outName) {
  WiFiClient client;
  HTTPClient http;
  http.begin(client, ACTIVE_URL);
  http.setTimeout(4000);

  int code = http.GET();
  if (code != 200) { http.end(); return false; }

  String body = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) return false;

  JsonVariant ap = doc["activeProduct"];
  if (ap.isNull()) return false;

  outBarcode = ap["barcode"] | "";
  outName    = ap["name"] | "";
  return outName.length() > 0;
}

// ─────────────────────────────────────────
//  POST /reading — sends consumption with product info
// ─────────────────────────────────────────
void sendReading(float consumedG, float finalG, float initialG) {
  Serial.println("Sending reading...");

  WiFiClient client;
  HTTPClient http;
  http.begin(client, READING_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  JsonDocument doc;
  doc["consumedG"]      = round(consumedG * 10.0) / 10.0;
  doc["weightG"]        = round(finalG     * 10.0) / 10.0;
  doc["initialWeightG"] = round(initialG   * 10.0) / 10.0;
  doc["deviceId"]       = "balanza-01";

  // Include product identification from the app scan
  if (activeBarcode.length() > 0) {
    doc["barcode"] = activeBarcode;
  }
  if (activeProductName.length() > 0) {
    doc["productName"] = activeProductName;
  }

  String payload;
  serializeJson(doc, payload);
  Serial.println("  Payload: " + payload);

  int code = http.POST(payload);
  String resp = http.getString();
  http.end();

  Serial.printf("  HTTP %d: %s\n", code, resp.c_str());
  if (code == 200 || code == 201) {
    Serial.println("Consumption registered!");
  } else {
    // Fallback: try without barcode (server will try activeProduct or auto-create)
    Serial.println("Server error — check that app has an active product");
  }
}

// ─────────────────────────────────────────
//  WiFi
// ─────────────────────────────────────────
void connectWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi OK  IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWiFi failed");
  }
}
