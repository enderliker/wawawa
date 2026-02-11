# 🚀 INICIO RÁPIDO - 5 MINUTOS

## Paso 1: Descargar el Proyecto

Ya tienes todos los archivos. Estructura completa:

```
discord-tts-bot/
├── run.js                               # ⚡ Bootstrap Pterodactyl
├── package.json                         # 📦 Dependencias
├── tsconfig.json                        # 🔧 Config TypeScript
├── .env.example                         # 🔐 Template env vars
├── .gitignore
├── README.md                            # 📖 Documentación completa
├── RESUMEN.md                           # 🎯 Resumen ejecutivo
├── scripts/
│   └── check.js                         # ✅ Verificación
└── src/
    ├── index.ts                         # 🚀 Entry point
    ├── bot.ts                           # 🤖 Lógica principal
    ├── guards/
    │   └── ownerOnly.ts                # 🔒 Seguridad
    ├── voice/
    │   ├── voiceManager.ts             # 🎙️ State machine
    │   └── follow.ts                   # 👣 Auto-follow
    ├── tts/
    │   ├── queue.ts                    # 📋 Cola TTS
    │   └── providers/
    │       ├── TtsProvider.ts          # 🎭 Interfaz
    │       ├── GttsProvider.ts         # 🆓 gTTS
    │       └── GoogleCloudProvider.ts  # ☁️ Google Cloud
    ├── commands/
    │   ├── say.ts                      # 💬 /say
    │   └── stop.ts                     # ⏹️ /stop
    ├── util/
    │   └── logger.ts                   # 📊 Logger
    └── types/
        └── libsodium.d.ts              # 📝 Tipos
```

## Paso 2: Crear Discord Bot (3 minutos)

1. Ve a: https://discord.com/developers/applications
2. Click "New Application" → Nombre: "Mi TTS Bot"
3. Sección "Bot" → "Add Bot"
4. Click "Reset Token" → **COPIA EL TOKEN** (lo necesitarás)
5. Activa **Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Sección "OAuth2" → "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Permisos: Send Messages, Connect, Speak, Use Voice Activity
7. **COPIA LA URL** e invita el bot a tu servidor

## Paso 3: Obtén tu Owner ID (30 segundos)

1. Discord → Settings → Advanced → ✅ Developer Mode
2. Click derecho en tu nombre → "Copy User ID"
3. **GUARDA ESTE ID**

## Paso 4: Configuración Local (1 minuto)

```bash
# En la carpeta del proyecto
npm install

# Crear archivo .env
cp .env.example .env

# Editar .env (nano, vim, o cualquier editor)
nano .env
```

**Configuración mínima en `.env`:**
```env
DISCORD_TOKEN=tu_token_aqui
OWNER_ID=tu_user_id_aqui
```

## Paso 5: Ejecutar (10 segundos)

### Desarrollo (con auto-reload):
```bash
npm run dev
```

### Producción:
```bash
npm run build
npm start
```

## ✅ Verificación

```bash
npm run check
```

Debe mostrar:
```
✓ All checks passed! ✨
```

## 🎮 Uso

1. **Únete a un canal de voz** en tu servidor
2. El bot **se une automáticamente** (auto-follow)
3. Usa comandos:
   - `/say Hola mundo` → El bot habla
   - `/stop` → Detiene el audio
4. **Escribe en el chat de voz** → El bot lee automáticamente

---

## 🐳 Deploy en Pterodactyl/Jexactyl

### Configuración del Panel:

1. **Sube todos los archivos** al servidor
2. **Startup Command:**
   ```
   node run.js
   ```
3. **Variables de Entorno:**
   ```
   DISCORD_TOKEN=tu_token_aqui
   OWNER_ID=tu_user_id_aqui
   ```
4. **Inicia el servidor**

`run.js` hace TODO automáticamente:
- ✅ Verifica Node 22+
- ✅ Instala dependencias (`npm install`)
- ✅ Compila TypeScript (`npm run build`)
- ✅ Inicia el bot (`npm start`)

---

## 🛠️ Troubleshooting Rápido

### Bot no responde
```bash
# Verifica que esté online en Discord
# Verifica variables de entorno
cat .env

# Verifica logs
# El bot muestra todos los errores en consola
```

### Error de libsodium
```bash
# Reinstala dependencias
rm -rf node_modules package-lock.json
npm install
```

### Bot no se une a voz
- ✅ Verifica permisos: Connect, Speak
- ✅ Verifica que tu OWNER_ID sea correcto
- ✅ Verifica que estés en el canal de voz

### TTS no funciona
- ✅ Espera 1-2 segundos entre requests (anti-spam)
- ✅ Verifica que el texto no esté vacío
- ✅ Para gTTS: puede tener rate limits (prueba Google Cloud)

---

## 📋 Comandos Útiles

```bash
# Desarrollo
npm run dev          # Auto-reload con tsx

# Producción
npm run build        # Compila TypeScript
npm start            # Ejecuta compilado

# Verificación
npm run check        # Pre-flight checks

# Logs
# En producción, set LOG_PRETTY=false para JSON logs
# Útil para parsers como Loki, Elasticsearch, etc.
```

---

## 🎯 Siguiente Nivel

### Configuración Avanzada (Opcional)

**`.env` completo:**
```env
# Discord
DISCORD_TOKEN=...
OWNER_ID=...

# TTS
TTS_PROVIDER=gtts                    # o 'google'
LANG=es                              # o 'es-ES', 'es-US', etc.
MAX_TTS_CHARS=200
VOICE_NAME=es-ES-Standard-A          # Solo para Google Cloud

# Google Cloud (opcional)
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Voice
VOICE_JOIN_TIMEOUT=10000
VOICE_READY_TIMEOUT=20000
VOICE_MAX_RETRIES=3

# Logging
LOG_LEVEL=info                       # trace|debug|info|warn|error|fatal
LOG_PRETTY=true                      # false para JSON en producción
```

### Google Cloud TTS Setup (Mejor Calidad)

1. Crea proyecto en Google Cloud
2. Activa Cloud Text-to-Speech API
3. Crea service account → descarga JSON
4. Configura:
   ```env
   TTS_PROVIDER=google
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
   VOICE_NAME=es-ES-Standard-A
   LANG=es-ES
   ```

Voces disponibles:
- `es-ES-Standard-A` (Mujer, España)
- `es-US-Standard-A` (Mujer, USA)
- `es-US-Standard-B` (Hombre, USA)
- Y muchas más...

---

## 📚 Documentación Completa

- **RESUMEN.md**: Overview técnico del proyecto
- **README.md**: Documentación completa (setup, troubleshooting, arquitectura)

---

## ✨ Características

✅ **TTS Commands**: `/say` y `/stop`  
✅ **Auto-Follow**: Sigue al owner automáticamente  
✅ **Auto-Read**: Lee mensajes del chat de voz  
✅ **Owner-Only**: Seguridad total  
✅ **Fail-Closed**: Detección conservadora de chat de voz  
✅ **Anti-Spam**: Rate limiting  
✅ **Error Recovery**: Reintentos automáticos  
✅ **Production-Ready**: Logging, cleanup, shutdown ordenado  

---

## 🎉 ¡Listo!

Tu bot está **100% funcional** y listo para:
- Desarrollo local
- Deploy en Pterodactyl/Jexactyl
- Producción en cualquier servidor Node 22+

**¡Disfruta tu bot de TTS!** 🚀
