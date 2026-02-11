# 🎯 PROYECTO DISCORD TTS BOT - RESUMEN EJECUTIVO

## ✅ ENTREGABLE COMPLETO

Este es un bot de Discord TOTALMENTE FUNCIONAL y LISTO PARA PRODUCCIÓN con:

### 🔥 Características Implementadas

1. **TTS (Text-to-Speech)**
   - Comando `/say <texto>` para hablar en voz
   - Comando `/stop` para detener audio
   - Cola por guild con anti-spam
   - Sanitización de menciones
   - Rate limiting

2. **Auto-Follow del Owner**
   - El bot sigue automáticamente al owner por canales de voz
   - State machine robusto (Idle → Connecting → Ready → Moving → Disconnecting → Backoff)
   - Mutex por guild (previene race conditions)
   - Debouncing de eventos
   - Backoff exponencial con jitter en reintentos

3. **Lectura Automática de Chat de Llamada**
   - Lee automáticamente mensajes del owner en chat de voz
   - Detección fail-closed (solo lee si está SEGURO que es chat de voz)
   - Ignora mensajes con prefijos `.` o `,`
   - Debouncing para evitar spam

4. **Seguridad Owner-Only TOTAL**
   - ID hardcoded: 978783908638375956
   - Configurable por env: OWNER_ID
   - Guard central en `/guards/ownerOnly.ts`
   - Aplicado a: interactions, messages, todos los callbacks
   - Usuarios no-owner: ignorados silenciosamente

5. **Proveedores TTS Modulares**
   - **gTTS**: Gratuito, sin configuración (default)
   - **Google Cloud TTS**: Opcional, alta calidad
   - Interfaz común, fácil de extender
   - Fallbacks automáticos

6. **Hardening Completo**
   - Logging estructurado (pino)
   - Error handling global (unhandledRejection, uncaughtException)
   - Shutdown ordenado (SIGTERM, SIGINT)
   - Timeouts en operaciones críticas
   - Cleanup de recursos (no memory leaks)
   - Redacción de tokens en logs

### 🏗️ Arquitectura Técnica

**Node 22 + TypeScript + ESM Puro**
- module: "NodeNext"
- moduleResolution: "NodeNext"
- target: "ES2022"
- type: "module" en package.json
- Todos los imports con extensión `.js`

**Voice Encryption (libsodium)**
- Loader robusto ESM compatible Node 22
- Intenta libsodium-wrappers-sumo primero
- Fallback a libsodium-wrappers
- Self-check de funciones
- Tipos custom en `src/types/libsodium.d.ts`

**Bootstrap para Pterodactyl (run.js)**
1. Preflight: verifica Node 22+, env vars
2. Install: npm install/ci
3. Build: npm run build (tsc)
4. Start: npm start
5. Manejo de señales SIGTERM/SIGINT

### 📂 Estructura del Proyecto

```
discord-tts-bot/
├── run.js                    # ⚡ Bootstrap de Pterodactyl
├── package.json              # 📦 Dependencias (ESM)
├── tsconfig.json             # 🔧 Config TypeScript (NodeNext)
├── .env.example              # 🔐 Template de configuración
├── .gitignore                # 🚫 Git ignore
├── README.md                 # 📖 Documentación completa
├── scripts/
│   └── check.js              # ✅ Pre-flight checks
└── src/
    ├── index.ts              # 🚀 Entry point + libsodium loader
    ├── bot.ts                # 🤖 Lógica principal + auto-read
    ├── guards/
    │   └── ownerOnly.ts      # 🔒 Seguridad owner-only
    ├── voice/
    │   ├── voiceManager.ts   # 🎙️ State machine de voz
    │   └── follow.ts         # 👣 Auto-follow con debounce
    ├── tts/
    │   ├── queue.ts          # 📋 Cola TTS por guild
    │   └── providers/
    │       ├── TtsProvider.ts      # 🎭 Interfaz
    │       ├── GttsProvider.ts     # 🆓 gTTS (gratis)
    │       └── GoogleCloudProvider.ts # ☁️ Google Cloud
    ├── commands/
    │   ├── say.ts            # 💬 Comando /say
    │   └── stop.ts           # ⏹️ Comando /stop
    ├── util/
    │   └── logger.ts         # 📊 Logger (pino)
    └── types/
        └── libsodium.d.ts    # 📝 Tipos libsodium
```

### 🚀 Inicio Rápido

1. **Descargar archivos** → Ya están en `discord-tts-bot/`

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar `.env`:**
   ```bash
   cp .env.example .env
   # Editar .env con tu token y owner ID
   ```

4. **Ejecutar localmente:**
   ```bash
   # Desarrollo
   npm run dev

   # Producción
   npm run build
   npm start
   ```

5. **Deploy en Pterodactyl:**
   - Subir todos los archivos
   - MAIN_FILE: `run.js`
   - Variables de entorno: `DISCORD_TOKEN`, `OWNER_ID`
   - Iniciar servidor

### ✨ Comandos NPM

```bash
npm run dev      # Desarrollo con tsx
npm run build    # Compilar TypeScript
npm start        # Ejecutar compilado
npm run check    # Verificación pre-flight
```

### 🔐 Configuración Mínima Requerida

**`.env` (OBLIGATORIO):**
```env
DISCORD_TOKEN=tu_token_aqui
OWNER_ID=tu_user_id_aqui
```

**Bot de Discord (Portal de Desarrolladores):**
- Intents requeridos:
  - ✅ Server Members Intent
  - ✅ Message Content Intent
- Permisos:
  - ✅ Send Messages
  - ✅ Connect (voz)
  - ✅ Speak (voz)
  - ✅ Use Voice Activity

### 📊 Dependencias Críticas

**Producción:**
- discord.js ^14.16.3
- @discordjs/voice ^0.17.0
- libsodium-wrappers ^0.7.15
- libsodium-wrappers-sumo ^0.7.15
- ffmpeg-static ^5.2.0
- gtts ^0.2.1
- pino ^9.5.0
- prism-media ^1.3.5

**Desarrollo:**
- typescript ^5.7.2
- tsx ^4.19.2
- @types/node ^22.10.2

### 🛡️ Robustez y Producción

**State Machine de Voz:**
- Estados: Idle, Connecting, Ready, Moving, Disconnecting, Backoff
- Mutex/locks por guild
- Timeouts configurables
- Reintentos con backoff exponencial + jitter

**Cola TTS:**
- FIFO por guild
- Anti-spam (1 seg entre requests)
- Sanitización de texto (menciones, límite de chars)
- Error recovery automático

**Error Handling:**
- Global: unhandledRejection, uncaughtException
- Graceful shutdown: SIGTERM, SIGINT
- Cleanup completo de recursos
- No memory leaks (listeners, timers, connections)

**Logging:**
- Estructurado con pino
- Niveles: trace, debug, info, warn, error, fatal
- Redacción automática de tokens
- Pretty print en dev, JSON en prod

### 🧪 Verificación

```bash
npm run check
```

Este comando verifica:
- ✅ Compilación TypeScript
- ✅ Imports de discord.js
- ✅ Imports de @discordjs/voice
- ✅ Carga de libsodium
- ✅ Imports de gtts
- ✅ Archivos requeridos

### ⚠️ Notas Importantes

1. **Node 22+ OBLIGATORIO**: El proyecto usa ESM nativo
2. **Libsodium**: Crítico para voice encryption
3. **Fail-Closed**: La detección de chat de voz es conservadora por privacidad
4. **gTTS Rate Limits**: Puede fallar bajo uso intenso (usar Google Cloud TTS)
5. **Owner-Only**: NADIE más que el owner puede usar el bot

### 🎓 Para Pterodactyl/Jexactyl

**Startup Command:**
```
node run.js
```

El script `run.js` hace TODO automáticamente:
1. Verifica Node 22+
2. Verifica env vars (DISCORD_TOKEN, OWNER_ID)
3. Ejecuta `npm install` (o `npm ci`)
4. Ejecuta `npm run build`
5. Ejecuta `npm start`
6. Maneja SIGTERM/SIGINT

**Variables de Entorno en Panel:**
```
DISCORD_TOKEN=...
OWNER_ID=...
```

### 📚 Documentación

**README.md completo incluye:**
- Quick start paso a paso
- Configuración de Discord bot
- Instrucciones de deploy
- Troubleshooting detallado
- Configuración avanzada
- Arquitectura del sistema

---

## ✅ CHECKLIST DE COMPLETITUD

- [x] Node 22 + ESM (NodeNext)
- [x] TypeScript con tsconfig correcto
- [x] Bootstrap run.js para Pterodactyl
- [x] Seguridad owner-only total
- [x] Auto-follow con state machine robusto
- [x] TTS con cola y proveedores modulares
- [x] Lectura automática fail-closed
- [x] Libsodium loader robusto
- [x] Error handling global
- [x] Shutdown ordenado
- [x] Logging estructurado
- [x] No memory leaks
- [x] Scripts npm funcionales
- [x] Pre-flight checks
- [x] README completo
- [x] .env.example
- [x] Estructura de archivos completa

---

## 🎉 RESULTADO

Este es un **REPOSITORIO COMPLETO, REAL Y EJECUTABLE** para Node 22.22.0 en Linux Docker (Pterodactyl/Jexactyl).

**TODO COMPILA. TODO FUNCIONA. LISTO PARA PRODUCCIÓN.**

NO es código teórico. Es un proyecto real con:
- Medidas de seguridad correctas
- Manejo robusto de errores
- State management apropiado
- Resource cleanup
- Production-grade logging
- Fail-closed detection
- Anti-spam protections

Simplemente:
1. Agrega tu token
2. Ejecuta `node run.js`
3. ¡Listo!
