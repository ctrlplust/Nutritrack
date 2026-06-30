# NutriTrack — Guía Feria (Modo Local)

## Estado: ✅ FUNCIONANDO

Sistema completo de báscula inteligente con ESP32 + App Expo Go + Backend local (pglite).

## Requisitos

- Node.js 26+
- pnpm 11+
- WSL2 (o Linux)
- ESP32 con HX711 + celda de carga
- Celular con Expo Go (iOS/Android)
- Cuenta Pinggy (gratis, 60 min por túnel)

## Archivos importantes

| Archivo | Propósito |
|---|---|
| `artifacts/api-server/src/routes/nutritrack.ts` | Backend con todas las rutas |
| `artifacts/mobile/context/NutriContext.tsx` | URL Pinggy hardcodeada |
| `artifacts/mobile/.env` | Variables de entorno (gitignored) |
| `esp32/nutritrack_balanza.ino` | Sketch único de la ESP32 |

## Flujo de la app

App escanea barcode → POST /active → ESP32 detecta → pesa → POST /reading → consumo en app

## Paso a paso para ejecutar

### Terminal 1 — Backend (pglite local)

```bash
cd ~/nutritrack/artifacts/api-server
pnpm run start:local
```

Se seedean 174 productos automáticamente.
Escucha en `http://localhost:3000`.

### Terminal 2 — Túnel Pinggy (HTTPS para iOS)

```bash
ssh -p 443 -R0:localhost:3000 a.pinggy.io
```

Da URLs como:
```
https://xxxx-xxx-xxx-xxx.run.pinggy-free.link
```

**Copiar la URL HTTPS** y actualizarla en:

1. `artifacts/mobile/context/NutriContext.tsx` línea ~259:
   ```ts
   const esp32ServerUrl = "https://xxxx-xxx-xxx-xxx.run.pinggy-free.link";
   ```

2. `esp32/nutritrack_balanza.ino` línea ~11:
   ```c
   #define SERVER_BASE "https://xxxx-xxx-xxx-xxx.run.pinggy-free.link/api/nutritrack"
   ```

3. `esp32/config.example.h` línea ~9:
   ```c
   #define SERVER_BASE "https://xxxx-xxx-xxx-xxx.run.pinggy-free.link/api/nutritrack"
   ```

> ⚠️ El túnel expira cada 60 min. Repetir Terminal 2 y actualizar URL en los 3 archivos.

### Terminal 3 — Expo Dev Server

```bash
cd ~/nutritrack/artifacts/mobile
npx expo start --tunnel
```

Escanea el QR con Expo Go (celular).

### ESP32 — Cargar el sketch

1. Arduino IDE → abrir `esp32/nutritrack_balanza.ino`
2. Verificar que `WIFI_SSID` y `WIFI_PASSWORD` sean los de tu red
3. Verificar que `SERVER_BASE` tenga la URL Pinggy actual
4. Compilar y subir al ESP32

## Uso en feria

1. Encender ESP32 (se conecta al WiFi automáticamente)
2. Abrir Expo Go → escanear QR
3. En la app: escanear código de barras → **"Pesar en balanza"**
4. Esperar ~3s a que ESP32 detecte el producto activo
5. Colocar producto en la balanza
6. Retirar producto para servirse
7. Devolver producto a la balanza
8. ESP32 muestra resumen de consumo → se envía al backend
9. App recibe el consumo (polling cada 5s) y muestra toast

## Endpoints de la API

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/api/nutritrack/active` | Setear producto activo |
| GET | `/api/nutritrack/active` | Consultar producto activo (lo usa ESP32) |
| POST | `/api/nutritrack/reading` | Enviar consumo (lo usa ESP32) |
| GET | `/api/nutritrack/consumptions` | Obtener consumos (lo usa la app) |
| GET | `/api/nutritrack/products` | Listar productos |
| POST | `/api/nutritrack/products` | Crear producto |
| GET | `/api/nutritrack/inventory` | Listar inventario |
| POST | `/api/nutritrack/inventory` | Crear ítem de inventario |
| GET | `/api/nutritrack/status` | Estado del servidor |
| GET | `/api/nutritrack/events` | SSE (tiempo real) |

## Notas

- Pglite corre **en memoria**: al reiniciar el backend se pierden los datos (se reseedean los 174 productos)
- Para persistencia: usar Render con DATABASE_URL apuntando a Supabase
- El ESP32 usa `WiFiClientSecure` + `setInsecure()` (no verifica SSL, funciona con cualquier túnel HTTPS)
