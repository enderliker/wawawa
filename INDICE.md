# 📁 ÍNDICE COMPLETO DE ARCHIVOS

## 📋 Archivos de Configuración (Raíz)

| Archivo | Descripción |
|---------|-------------|
| **run.js** | Bootstrap principal para Pterodactyl. Maneja preflight, npm install, build y start |
| **package.json** | Dependencias y scripts NPM. Configurado como ESM (`"type": "module"`) |
| **tsconfig.json** | Configuración TypeScript con `NodeNext`, `ES2022`, output a `dist/` |
| **.env.example** | Template de variables de entorno con todas las opciones documentadas |
| **.gitignore** | Archivos ignorados por git (node_modules, dist, .env, etc.) |

## 📖 Documentación

| Archivo | Descripción |
|---------|-------------|
| **INICIO-RAPIDO.md** | Guía de inicio en 5 minutos con comandos copy-paste |
| **RESUMEN.md** | Resumen ejecutivo del proyecto, arquitectura y checklist de completitud |
| **README.md** | Documentación completa: setup, troubleshooting, arquitectura, deploy |

## 🔧 Scripts Auxiliares

| Archivo | Propósito |
|---------|-----------|
| **scripts/check.js** | Pre-flight checks: verifica compilación, imports de módulos críticos, archivos requeridos |

## 💻 Código Fuente TypeScript

### 🚀 Entry Point

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/index.ts** | Entry point principal. Carga libsodium, valida env, setup error handlers, inicia bot |

### 🤖 Core del Bot

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/bot.ts** | Lógica principal del bot. Maneja comandos, auto-lectura de chat de voz, coordinación de componentes |

### 🔒 Seguridad

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/guards/ownerOnly.ts** | Sistema de seguridad owner-only. Guards para interactions, messages, wrapper functions |

### 🎙️ Gestión de Voz

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/voice/voiceManager.ts** | State machine robusto para conexiones de voz. Maneja join/move/leave con mutex, timeouts, backoff |
| **src/voice/follow.ts** | Auto-follow del owner en canales de voz con debouncing de eventos |

### 🔊 Sistema TTS

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/tts/queue.ts** | Cola TTS por guild con anti-spam, sanitización, rate limiting |
| **src/tts/providers/TtsProvider.ts** | Interfaz base para proveedores TTS y configuración |
| **src/tts/providers/GttsProvider.ts** | Implementación gTTS (gratuito) con timeouts y error handling |
| **src/tts/providers/GoogleCloudProvider.ts** | Implementación Google Cloud TTS (opcional) con fallbacks de voces |

### 💬 Comandos Slash

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/commands/say.ts** | Comando `/say <text>` - hace hablar al bot en voz |
| **src/commands/stop.ts** | Comando `/stop` - detiene audio y limpia cola |

### 🛠️ Utilidades

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/util/logger.ts** | Logger estructurado con pino. Redacción de tokens, child loggers |

### 📝 Tipos TypeScript

| Archivo | Responsabilidad |
|---------|-----------------|
| **src/types/libsodium.d.ts** | Declaraciones de tipos para libsodium-wrappers y libsodium-wrappers-sumo |

---

## 🗂️ Directorios Generados (No en Repo)

Estos se crean automáticamente:

- **node_modules/** - Dependencias NPM instaladas
- **dist/** - Código TypeScript compilado a JavaScript (output de `tsc`)
- **package-lock.json** - Lock file de versiones exactas

---

## 📊 Estadísticas del Proyecto

```
Total de archivos fuente: 18
Líneas de código TypeScript: ~2,000+
Archivos de documentación: 4
Scripts auxiliares: 2
Proveedores TTS: 2 (gTTS + Google Cloud)
Comandos slash: 2 (/say, /stop)
```

---

## 🔍 Detalles por Componente

### State Machine de Voz (voiceManager.ts)

**Estados:**
- `Idle` - No conectado
- `Connecting` - Uniéndose a canal
- `Ready` - Conectado y listo
- `Moving` - Moviéndose entre canales
- `Disconnecting` - Desconectando
- `Backoff` - Esperando antes de reintentar

**Características:**
- Mutex/locks por guild (previene race conditions)
- Timeouts configurables en join/ready
- Backoff exponencial con jitter en reintentos
- Event handlers para estados de conexión
- Cleanup completo de recursos

### Cola TTS (queue.ts)

**Características:**
- Cola FIFO por guild
- Anti-spam: rate limit de 1 seg entre requests
- Sanitización: elimina @everyone, @here, menciones
- Límite de caracteres configurable (default 200)
- Error recovery automático
- Manejo de estados del audio player

### Sistema de Comandos

**Registro:**
- Automático al inicio del bot
- Usa Discord REST API
- Comandos globales (disponibles en todos los servers)

**Ejecución:**
- Guard owner-only antes de procesar
- Defer reply para operaciones largas
- Error handling con mensajes al usuario
- Logging estructurado

### Libsodium Loader (index.ts)

**Estrategia de carga:**
1. Intenta importar `libsodium-wrappers-sumo` (recomendado)
2. Si falla, fallback a `libsodium-wrappers`
3. Extrae sodium del módulo (maneja default exports)
4. Espera a `sodium.ready`
5. Self-check de funciones requeridas
6. Si todo falla, exit(1) con instrucciones detalladas

---

## 🚀 Flujo de Ejecución

### Inicio del Bot

```
run.js
  ↓
1. Preflight checks
   - Verifica Node 22+
   - Verifica env vars (DISCORD_TOKEN, OWNER_ID)
  ↓
2. npm install/ci
  ↓
3. npm run build (tsc)
  ↓
4. npm start
  ↓
src/index.ts
  ↓
5. Valida environment
6. Carga libsodium
7. Crea DiscordBot instance
8. Setup error handlers
9. bot.start()
  ↓
src/bot.ts
  ↓
10. Login a Discord
11. Espera ready event
12. Registra slash commands
13. Setup event listeners:
    - interactionCreate (comandos)
    - messageCreate (auto-read)
    - voiceStateUpdate (tracking)
  ↓
¡Bot online y funcionando!
```

### Procesamiento de Comandos

```
Usuario ejecuta /say
  ↓
interactionCreate event
  ↓
guardInteraction (owner-only check)
  ↓
sayCommand.execute()
  ↓
1. Verifica que user esté en voz
2. Asegura que bot esté en voz
3. Encola TTS (ttsQueue.enqueue)
  ↓
ttsQueue.enqueue()
  ↓
1. Rate limit check
2. Sanitiza texto
3. Agrega a cola
4. Inicia processing
  ↓
ttsQueue.processQueue()
  ↓
1. Obtiene siguiente item de cola
2. Sintetiza audio (provider.synthesize)
3. Crea audio resource
4. Reproduce en audio player
5. Espera a que termine
6. Procesa siguiente item
```

### Auto-Follow

```
Owner se mueve de canal
  ↓
voiceStateUpdate event
  ↓
VoiceFollower.handleVoiceStateUpdate()
  ↓
Debounce (500ms)
  ↓
VoiceFollower.processVoiceStateUpdate()
  ↓
Detecta tipo de cambio:
- Join → handleOwnerJoin()
- Move → handleOwnerMove()
- Leave → handleOwnerLeave()
  ↓
voiceManager.join/move/leave()
  ↓
State machine execution con:
- Mutex lock
- Timeouts
- Retries con backoff
- Error recovery
```

### Auto-Read de Chat

```
Owner escribe en chat
  ↓
messageCreate event
  ↓
1. guardMessage (owner check)
2. Verifica prefijo (ignora . y ,)
3. isVoiceChatMessage() check
  ↓
isVoiceChatMessage()
  ↓
FAIL-CLOSED detection:
1. Bot debe estar en voz
2. Busca relación voice-text channel
3. Solo lee si está SEGURO
  ↓
Si pasa todas las checks:
  ↓
Debounce (300ms)
  ↓
readMessage()
  ↓
ttsQueue.enqueue()
  ↓
(mismo flujo que /say)
```

---

## 💾 Gestión de Recursos

### Conexiones de Voz
- Destruidas al leave
- Event listeners removidos
- Maps limpiados

### Audio Players
- Stopped al cleanup
- Listeners removidos
- Resources liberados

### Timers
- Debounce timers cleared
- Backoff timers cleared
- Timeout handlers cleaned

### Shutdown Ordenado
```
SIGTERM/SIGINT
  ↓
bot.shutdown()
  ↓
1. Clear debounce timers
2. voiceFollower.cleanup()
3. voiceManager.cleanupAll()
4. ttsQueue.cleanup() (por cada guild)
5. client.destroy()
  ↓
process.exit(0)
```

---

## ✅ Checklist de Archivos

- [x] run.js - Bootstrap
- [x] package.json - Deps
- [x] tsconfig.json - Config TS
- [x] .env.example - Template
- [x] .gitignore - Git
- [x] README.md - Docs
- [x] RESUMEN.md - Overview
- [x] INICIO-RAPIDO.md - Quick start
- [x] scripts/check.js - Verificación
- [x] src/index.ts - Entry
- [x] src/bot.ts - Core
- [x] src/guards/ownerOnly.ts - Security
- [x] src/voice/voiceManager.ts - Voice state
- [x] src/voice/follow.ts - Auto-follow
- [x] src/tts/queue.ts - TTS queue
- [x] src/tts/providers/TtsProvider.ts - Interface
- [x] src/tts/providers/GttsProvider.ts - gTTS
- [x] src/tts/providers/GoogleCloudProvider.ts - Google
- [x] src/commands/say.ts - /say
- [x] src/commands/stop.ts - /stop
- [x] src/util/logger.ts - Logger
- [x] src/types/libsodium.d.ts - Types

**TOTAL: 22 archivos completos y funcionales**
