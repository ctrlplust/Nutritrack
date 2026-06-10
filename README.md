<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Estado-En%20Desarrollo-22c55e?style=for-the-badge&labelColor=09090b">
  <img alt="Estado" src="https://img.shields.io/badge/Estado-En%20Desarrollo-22c55e?style=for-the-badge&labelColor=e4e4e7">
</picture>

<h1 align="center">🥗 NutriTrack</h1>
<p align="center">
  <strong>Aduana de Cocina inteligente</strong><br>
  Control de consumo alimenticio con balanza conectada ESP32
</p>

<p align="center">
  <img alt="React Native" src="https://img.shields.io/badge/React_Native-20232A?logo=react&logoColor=61DAFB">
  <img alt="Expo" src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-000000?logo=express&logoColor=white">
  <img alt="ESP32" src="https://img.shields.io/badge/ESP32-E7352C?logo=espressif&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
</p>

---

## 📋 Tabla de Contenidos

- [Arquitectura](#-arquitectura)
- [Tecnologías](#-tecnologías)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Guía de Ejecución](#-guía-de-ejecución)
  - [Paso 1: Backend (WSL2)](#paso-1-compilar-e-inicializar-el-backend-terminal-1---wsl2)
  - [Paso 2: Túnel Pinggy (WSL2)](#paso-2-crear-el-túnal-seguro-para-dispositivos-ios-terminal-2---wsl2)
  - [Paso 3: Expo Metro (WSL2)](#paso-3-lanzar-el-empaquetador-de-metro-terminal-3---wsl2)
  - [Paso 4: ESP32 (Windows)](#paso-4-inicialización-física-del-hardware-arduino-ide---windows)
- [Diagrama de Flujo](#-diagrama-de-flujo)
- [Contribuir](#-contribuir)

---

## 🏗 Arquitectura

```
                  ┌──────────────┐
  ┌───────────────┤   App Móvil  ├──────────────┐
  │               │ (React Native│              │
  │               │    Expo Go)  │              │
  │               └──────┬───────┘              │
  │                      │ HTTPS                │
  ▼                      ▼                      ▼
┌───────┐         ┌──────────────┐         ┌────────┐
│Túnel  │◄────────│  Pinggy.io   │────────►│Backend │
│Pinggy │         │ (Opcional)   │         │Express │
└───────┘         └──────────────┘         │:3000   │
                                           └───┬────┘
                                               │ HTTP
                                               ▼
                                          ┌────────┐
                                          │ ESP32  │
                                          │Balanza │
                                          └────────┘
```

| Ruta de comunicación | Protocolo |
|---|---|
| App → Backend (local) | `HTTP` |
| App → Backend (iOS/túnel) | `HTTPS` |
| ESP32 → Backend | `HTTP` |
| ESP32 → Polling `GET /active` | `HTTP` cada 3s |

### 🌐 Modelo de Conectividad

```
      ┌─────────────────── RED LOCAL (192.168.1.x) ───────────────────┐
      │                                                               │
      │  ┌──────────────┐                   ┌──────────────────────┐  │
      │  │   ESP32       │  HTTP (puerto    │  PC Windows (WSL2)   │  │
      │  │   Balanza     │◄────3000────────►│  Backend Express     │  │
      │  │   (Cliente)   │  GET /active     │  192.168.1.94:3000   │  │
      │  │               │  POST /reading   │                      │  │
      │  └──────────────┘                   └──────────────────────┘  │
      │                                                               │
      │                      ┌──────────────┐                        │
      │  ┌──────────────┐    │  Router/WiFi  │    ┌──────────────┐   │
      │  │  iPhone (App) │───►  Asigna IPs   │◄───│  Túnel       │   │
      │  │  Expo Go      │    │  192.168.1.x │    │  Pinggy.io   │   │
      │  └──────────────┘    └──────────────┘    │  HTTPS       │   │
      │                                                    │      │
      └────────────────────────────────────────────────────┘      │
                                                          ┌──────┴───┐
                                                          │ Internet │
                                                          └──────────┘
```

**¿Por qué el ESP32 usa HTTP y no HTTPS?**
- El ESP32 y tu PC están en la **misma red local** (`192.168.1.x`). El tráfico viaja directo a través del router, sin salir a internet. No necesita cifrado porque nunca abandona la LAN.
- `192.168.1.94` es un **ejemplo**. Cada red local asigna IPs distintas. Para conocer tu propia IP:

- **Windows**: Abrí `CMD` y ejecutá `ipconfig`. Buscá la línea `Dirección IPv4` en tu adaptador Wi-Fi (ej: `192.168.0.15`, `10.0.0.5`, etc.).
- **WSL**: Ejecutá `ip addr show eth0 | grep inet`.
- **Linux**: Ejecutá `hostname -I`.

Esa IP es la que va en el `esp32ServerUrl` de la app y en el `SERVER_BASE` del ESP32.

**¿Por qué la App iOS necesita un túnel?**
- Apple **exige HTTPS** para cualquier conexión HTTP desde apps sobre redes móviles (celular). El túnel Pinggy.io envuelve la conexión en HTTPS y la reenvía a tu backend local.
- Mientras el ESP32 se comunica por **HTTP directo** (red local), el iPhone lo hace por **HTTPS** vía túnel — ambos llegan al mismo backend en `localhost:3000`.

---

## 🛠 Tecnologías

| Capa | Tecnología |
|---|---|
| **Frontend** | React Native + Expo + TypeScript |
| **Backend** | Node.js + Express + TypeScript |
| **Base de datos** | Drizzle ORM + SQLite (en memoria) |
| **Hardware** | ESP32 + HX711 + Celda de carga |
| **Comunicación** | REST API + SSE (Server-Sent Events) |
| **Túnel (iOS)** | Pinggy.io (HTTPS forzado) |

---

## 📁 Estructura del Proyecto

```
nutritrack/
├── artifacts/
│   ├── api-server/          # Backend Express
│   │   ├── src/
│   │   │   ├── routes/      # Endpoints REST
│   │   │   └── index.ts     # Punto de entrada
│   │   └── dist/            # Build de distribución
│   └── mobile/              # App React Native / Expo
│       ├── app/             # Pantallas (Expo Router)
│       ├── components/      # Componentes reutilizables
│       └── context/         # Estado global (NutriContext)
├── esp32/                   # Firmware ESP32
│   ├── nutritrack_balanza/
│   │   └── nutritrack_balanza.ino
│   └── nutritrack_balanza.ino
├── lib/                     # Librerías compartidas
└── scripts/                 # Utilidades
```

---

## 🚀 Guía de Ejecución

> Siga estrictamente este orden secuencial **multiterminal** para inicializar el entorno completo.

---

### Paso 1: Compilar e Inicializar el Backend (Terminal 1 — WSL2)

Construya los artefactos de distribución y levante el servidor Express escuchando en **todas las interfaces de red**:

```bash
cd ~/nutritrack/artifacts/api-server
pnpm run build
HOST=0.0.0.0 PORT=3000 pnpm run start
```

```
✓ Server listening  port: 3000
```

> El flag `HOST=0.0.0.0` permite que el servidor acepte conexiones desde cualquier interfaz de red, incluyendo el túnel y el ESP32 en la LAN.

---

### Paso 2: Crear el Túnel Seguro para iOS (Terminal 2 — WSL2)

Exponga el puerto local del backend hacia internet para saltar las restricciones de **HTTPS forzado en iOS**:

```bash
ssh -p 443 -R0:localhost:3000 a.pinggy.io
```

Al conectarse, obtendrá una URL similar a:

```
https://xxxx-xxx-xxx-xxx.run.pinggy-free.link
```

**Importante:** Copie esa URL e inyéctela en la variable global `esp32ServerUrl` ubicada en:

```
artifacts/mobile/context/NutriContext.tsx
```

```typescript
const esp32ServerUrl = "https://xxxx-xxx-xxx-xxx.run.pinggy-free.link";
```

> ⚠️ El túnel de Pinggy gratuito expira cada 60 minutos. Si expira, repita este paso y actualice la URL.

---

### Paso 3: Lanzar el Empaquetador de Metro (Terminal 3 — WSL2)

Inicialice Expo Go forzando el mapeo del host hacia el adaptador virtual de Windows, limpiando la caché previa:

```bash
cd ~/nutritrack/artifacts/mobile
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.94 npx expo start -c --lan
```

```
Starting Metro Bundler
Waiting on http://192.168.1.94:8081
```

Escanee el **código QR** resultante desde su dispositivo móvil con la app **Expo Go**.

---

### Paso 4: Inicialización Física del Hardware (Arduino IDE — Windows)

1. Conecte la placa **ESP32** vía USB a su computadora.
2. Abra el **Arduino IDE nativo de Windows** (el cual posee el control del bus físico sobre el puerto de comunicación, ej. `COM3`).
3. Cargue el sketch ubicado en:
   ```
   \\wsl$\Arch\home\tomi\nutritrack\esp32\nutritrack_balanza.ino
   ```
4. Abra el **Monitor Serie** configurado a **115200 baudios**.
5. Realice una simulación de escaneo desde la aplicación móvil y verifique la transición inmediata y asíncrona de los estados en la consola del hardware.

**Salida esperada en el Monitor Serie:**

```
=== NutriTrack — Aduana de Cocina ===
✓ Balanza lista.
✓ WiFi conectado! IP: 192.168.1.xxx
. . . . . 
[¡ÉXITO!] Escaneo detectado desde tu App.
[ESTADO 0 → ESTADO 1] Coloca el producto en la balanza.
```

---

## 🔄 Diagrama de Flujo

```
┌─────────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────┐
│  App Móvil  │────►│  POST /active │────►│  Backend     │────►│  ESP32   │
│  Escanea    │     │  (fija prod)  │     │  almacena    │     │  Polling │
│  código     │     │               │     │  activeProd  │     │  GET     │
└─────────────┘     └───────────────┘     └──────┬───────┘     │  /active │
                                                  │              └────┬─────┘
                                                  │  HTTP 200        │
                                                  │  {activeProduct} │
                                                  ▼                  ▼
                                          ┌──────────────┐     ┌──────────┐
                                          │  ESP32       │◄────│  Inicia  │
                                          │  Estado 1    │     │  Ciclo   │
                                          │  Pesar prod  │     │  Pesado  │
                                          └──────┬───────┘     └──────────┘
                                                  │
                                                  │  POST /reading
                                                  ▼
                                          ┌──────────────┐
                                          │  Backend      │
                                          │  Guarda cons. │
                                          │  active=null  │
                                          └──────────────┘
```

---

## 🤝 Contribuir

1. Haga un fork del repositorio
2. Cree una rama (`git checkout -b feature/nueva-funcionalidad`)
3. Realice sus cambios
4. Commit (`git commit -m "feat: descripción"`)
5. Push (`git push origin feature/nueva-funcionalidad`)
6. Abra un Pull Request

---

<p align="center">
  <sub>Proyecto desarrollado para la asignatura Aduana de Cocina — 2026</sub>
</p>
