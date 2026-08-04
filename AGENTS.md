# PixelWeb

Web-based pixel-art multiplayer world-map game. Single Node/TypeScript package (not a monorepo), organized into workspaces:

- `client/` — Phaser 3 + Vite frontend (rendering, HUD, WebGL FX). Renders only; never interprets map data.
- `server/` — Express + Socket.io backend. Multiplayer authority + map layers HTTP API (`/api/maps/*`). Serves the built client in production.
- `shared/` — shared TypeScript types and map/game logic.
- `scripts/` — offline map data pipeline (ingest → interpret).

State is in-memory (no database). Map data is persisted to disk as binary files under `data/` (git-ignored).

## Cursor Cloud specific instructions

Standard commands live in `package.json` `scripts` and `README.md` (README is in Spanish). Key notes below are the non-obvious ones.

- Run the app in dev with `npm run dev` (root). It runs BOTH services concurrently: backend on `:3001` (`tsx watch server/index.ts`) and Vite client on `:5173` (`vite`). Open the app at `http://localhost:5173` — Vite proxies `/api` and `/socket.io` to `:3001`. Do not open `:3001` directly for the UI in dev unless you've run `npm run build` first.
- Health checks: `GET http://localhost:3001/health` and `GET http://localhost:3001/api/maps/health`.
- There is NO test framework and NO lint script in this repo (no `test` script, no ESLint/CI config). "Testing" is manual: run dev, open the browser, move with WASD, and send a chat message. Multiplayer can be checked with two browser tabs.
- Map data pipeline is a ONE-TIME, network-dependent step, intentionally kept OUT of the startup/update script. Run `npm run maps:build -- --world=default` once to populate `data/` (downloads from AWS Terrarium, Microsoft Planetary Computer / ESA CCI, and Natural Earth over HTTPS; takes ~20–30s). Output lands in `data/ingested` + `data/interpreted` (both git-ignored, but they persist in the VM snapshot). The `default` world is 4096×2048. `earth3x` (12288×6144) is a second, larger world that is NOT built by default; requests to it return HTTP 503 until you run `npm run maps:build -- --world=earth3x --force` — this is expected, not a bug.
- The server loads map data only at boot (`boot()` in `server/index.ts`). After running `maps:build`, RESTART the dev server so it picks up the new `data/` — `tsx watch` only watches source files, not `data/`. Without map data the server still runs and multiplayer/chat/movement work, but `/api/maps/world/*` returns 503 and no map layers render.
- Gameplay gotcha for manual testing: players cannot move through ocean tiles (MASK `agua`). If you spawn in water (e.g. the "Argentina" starting area lands in the Pacific), movement is blocked. Pick a land starting area such as "EEUU" (USA) from the boot screen so WASD movement works.
- `sharp` (used for map preview PNGs) needs a native toolchain (`python3 make g++`) if it has to compile, but prebuilt binaries normally install fine via `npm install`.
