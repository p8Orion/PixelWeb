# PixelWeb

Juego web **pixel art multiplayer** con mapa del mundo en layers. La **representación** pixel art es un paso aparte; primero hay datos e interpretación de juego.

## Stack

- **Phaser 3** — cliente / presentación
- **Socket.io + Express** — autoridad multiplayer **y** mapa de juego
- **Vite + TypeScript**

## Arquitectura del mapa (importante)

Dos etapas separadas a propósito:

| Etapa | Qué hace | Dónde vive | Varía? |
|--------|----------|------------|--------|
| **Ingest** | Baja/resamplea datos e imágenes a un grid neutro | `data/ingested/` | Fuentes (Terrarium, NE1, WorldCover…) |
| **Interpret** | Convierte eso en **conceptos de juego** (landmask, landcover, …) | `data/interpreted/<profile>/` + **memoria del server** | Perfiles en `server/maps/interpret/profiles/` |

El cliente **no interpreta**: solo pide `/api/maps/world/*` al servidor.

```
data/raw/          cache de descargas
data/ingested/     elevation + basemap + cover_raw (CCI) + hydro_raw (ríos/lagos)
data/interpreted/  landmask + elevation + landcover (perfil de juego)
server  ──GET──►  /api/maps/world/meta|*.bin|preview.png
client  ◄────────  layers ya interpretados (solo pinta)
```

## Cómo correr

```bash
npm install
npm run maps:build          # ingest + interpret (una vez, necesita red)
npm run dev                 # server interpreta/carga al boot
```

Abrí [http://localhost:5173](http://localhost:5173).

### Scripts de mapa

```bash
npm run maps:ingest                 # Terrarium + NE1 + ESA CCI 300m + NE hydro
npm run maps:ingest -- --only=hydro # solo ríos/lagos (si ya hay ingest)
npm run maps:interpret -- --force   # tipificación de juego
npm run maps:build -- --width=4096 --elev-zoom=4 --force
```

**Cover:** ESA CCI 300 m. **Hydro:** Natural Earth 10m rivers+lakes → `hydro_raw` (0/1/2); el interpret pinta ríos/lagos como `freshwater`.

Reinterpretar en caliente: `POST /api/maps/world/reinterpret` con `{ "profile": "default" }`.

## Controles

| Acción | Tecla |
|--------|--------|
| Mover | WASD / flechas |
| Zoom | Rueda del mouse |
| Chat | Abajo + Enter |

## Producción

```bash
npm run build
npm start
```
