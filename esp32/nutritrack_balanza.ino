#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "HX711.h"

// ─────────────────────────────────────────
//  ⚙️  CONFIGURACIÓN RED LOCAL
// ─────────────────────────────────────────
#define WIFI_SSID        "Pochita"
#define WIFI_PASSWORD    "4c3opij0km"

// ¡Apuntamos directamente a tu PC en la red local!
#define SERVER_BASE      "http://192.168.1.94:3000/api/nutritrack"
#define SERVER_URL       SERVER_BASE "/reading"
#define POLL_URL         SERVER_BASE "/active"

// ─────────────────────────────────────────
//  PINES — NO MODIFICAR
// ─────────────────────────────────────────
#define LOADCELL_DOUT_PIN  32
#define LOADCELL_SCK_PIN   33

// ─────────────────────────────────────────
//  CONFIGURACIÓN BALANZA
// ─────────────────────────────────────────
#define FACTOR_CALIBRACION  -445.24
#define UMBRAL_PESO          10.0     
#define MUESTRAS             10       
#define TOLERANCIA_DELTA      5.0     

enum Estado {
  ESTADO_0_IDLE,
  ESTADO_1_ESPERANDO_PRODUCTO,
  ESTADO_2_ESPERANDO_RETIRO,
  ESTADO_3_ESPERANDO_DEVOLUCION
};

HX711  balanza;
Estado estado_actual = ESTADO_0_IDLE;
float  peso_inicial  = 0.0;
float  peso_final    = 0.0;
float  delta         = 0.0;
unsigned long ultimaPeticion = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("=== NutriTrack — Aduana de Cocina ===");

  balanza.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  balanza.set_scale(FACTOR_CALIBRACION);
  balanza.tare();
  Serial.println("✓ Balanza lista.");

  conectarWiFi();
  Serial.println("Enviá 'S' para iniciar manual, o escanea en la App.");
}

float leerPeso() {
  return balanza.get_units(MUESTRAS);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }

  switch (estado_actual) {
    case ESTADO_0_IDLE:
      if (millis() - ultimaPeticion >= 3000) {
        ultimaPeticion = millis();
        Serial.print("."); 
        checkActiveProduct();
      }
      
      if (Serial.available() > 0) {
        char c = Serial.read();
        if (c == 'S' || c == 's') {
          Serial.println("\n[ESTADO 0] Señal manual. Coloca el producto en la balanza.");
          estado_actual = ESTADO_1_ESPERANDO_PRODUCTO;
        }
      }
      break;

    case ESTADO_1_ESPERANDO_PRODUCTO: {
      float lectura = leerPeso();
      if (lectura > UMBRAL_PESO) {
        Serial.println("\n[ESTADO 1] Producto detectado. Estabilizando...");
        delay(2000); 

        peso_inicial = leerPeso();
        Serial.print("[ESTADO 1] Peso inicial: ");
        Serial.print(peso_inicial, 2);
        Serial.println(" g");
        Serial.println("Retira el producto para servirte.");

        estado_actual = ESTADO_2_ESPERANDO_RETIRO;
      }
      break;
    }

    case ESTADO_2_ESPERANDO_RETIRO: {
      float lectura = leerPeso();
      if (lectura < UMBRAL_PESO) {
        Serial.println("[ESTADO 2] Producto retirado. Sírvete y devuelve el paquete.");
        delay(500);
        estado_actual = ESTADO_3_ESPERANDO_DEVOLUCION;
      }
      break;
    }

    case ESTADO_3_ESPERANDO_DEVOLUCION: {
      float lectura = leerPeso();
      if (lectura > UMBRAL_PESO) {
        Serial.println("[ESTADO 3] Paquete devuelto. Estabilizando...");
        delay(2000);

        peso_final = leerPeso();
        delta      = peso_inicial - peso_final;

        Serial.println("\n╔══════════════════════════════╗");
        Serial.println("║     RESUMEN DE CONSUMO       ║");
        Serial.println("╠══════════════════════════════╣");
        Serial.print  ("║  Peso inicial : "); Serial.print(peso_inicial, 2); Serial.println(" g");
        Serial.print  ("║  Peso final   : "); Serial.print(peso_final, 2);   Serial.println(" g");
        Serial.print  ("║  Consumo (Δ)  : "); Serial.print(delta, 2);        Serial.println(" g");
        Serial.println("╚══════════════════════════════╝");

        if (delta >= TOLERANCIA_DELTA) {
          enviarConsumo(delta, peso_final, peso_inicial);
        } else {
          Serial.println("⚠ Delta demasiado pequeño, no se registra.");
        }

        Serial.println("\nEnviá 'S' para un nuevo ciclo o escanea en la app.\n");
        estado_actual = ESTADO_0_IDLE;
      }
      break;
    }
  }
}

// ─────────────────────────────────────────
//  CHECK PRODUCTO ACTIVO (POLLING HTTP)
// ─────────────────────────────────────────
void checkActiveProduct() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client; // Usamos cliente normal para la red local
  HTTPClient http;
  http.begin(client, POLL_URL);
  http.setTimeout(4000);

  int httpCode = http.GET();

  if (httpCode > 0) {
    if (httpCode == 200) {
      String payload = http.getString();
      StaticJsonDocument<512> doc;
      DeserializationError error = deserializeJson(doc, payload);

      if (!error) {
        bool productoDetectado = false;
        
        if (doc.containsKey("activeProduct") && !doc["activeProduct"].isNull()) {
          productoDetectado = true;
        } else if (doc.containsKey("id") || doc.containsKey("name") || doc.containsKey("barcode")) {
          productoDetectado = true;
        } else if (payload.indexOf("id") != -1 || payload.indexOf("product") != -1) {
          productoDetectado = true;
        }

        if (productoDetectado) {
          Serial.println("\n\n[¡ÉXITO!] Escaneo detectado desde tu App.");
          Serial.println("[ESTADO 0 -> ESTADO 1] Iniciando ciclo. Coloca el producto en la balanza.");
          estado_actual = ESTADO_1_ESPERANDO_PRODUCTO;
        }
      }
    } else {
      // Ignoramos errores 204 o similares para no ensuciar la consola si no hay producto activo
      if (httpCode != 204) {
         Serial.printf("\n[Polling] Error HTTP: %d\n", httpCode);
      }
    }
  } 
  
  http.end();
}

// ─────────────────────────────────────────
//  ENVIAR CONSUMO (HTTP)
// ─────────────────────────────────────────
void enviarConsumo(float consumidoG, float pesoFinalG, float pesoInicialG) {
  Serial.println("\n→ Enviando datos a NutriTrack (Local)...");

  WiFiClient client;
  HTTPClient http;
  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  StaticJsonDocument<128> doc;
  doc["consumedG"]      = round(consumidoG  * 10.0) / 10.0;
  doc["weightG"]        = round(pesoFinalG  * 10.0) / 10.0;
  doc["initialWeightG"] = round(pesoInicialG * 10.0) / 10.0;
  doc["deviceId"]       = "balanza-01";

  String payload;
  serializeJson(doc, payload);
  Serial.println("   Payload: " + payload);

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("   Respuesta %d: %s\n", httpCode, response.c_str());
    if (httpCode == 200 || httpCode == 201) {
      Serial.println("✅ ¡Consumo registrado en la app!");
    } else {
      Serial.println("⚠ El servidor devolvió error. Revisa que la app tenga un producto activo.");
    }
  } else {
    Serial.printf("✗ Error de conexión: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ─────────────────────────────────────────
//  CONECTAR WIFI
// ─────────────────────────────────────────
void conectarWiFi() {
  Serial.printf("\nConectando a %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    intentos++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n✓ WiFi conectado! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n✗ No se pudo conectar al WiFi.");
  }
}
