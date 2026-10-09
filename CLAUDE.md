# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Vanilla JS Tetris (HTML5 Canvas). No deps, no build, no tests, no linter, no package.json. README.md (Spanish) has user-facing docs; UI strings are Spanish.

## Run

Open `index.html` directly, or serve statically: `python -m http.server 8000` → http://localhost:8000.

## Architecture

All logic in `game.js` (single script, global state, loaded by `index.html` via plain `<script>`). DOM ids it depends on: `board`, `next-canvas`, `score`, `lines`, `level`, `overlay`, `overlay-title`, `overlay-score`, `restart-btn`, `energy-fill`, `ability-status`, `ability-menu`, `hold-section`, `hold-canvas`, `queue-section`, `queue-canvas`, `skin-select` — renaming in `index.html` breaks it.

- Board: `ROWS×COLS` matrix; 0 = empty, 1–7 = piece type index into both `COLORS` and `PIECES` (piece shape cells hold their own type index).
- Flow: `init()` → `spawn()` → rAF `loop()` drops piece per `dropInterval`; `lockPiece()` = `merge()` → `clearLines()` → `spawn()`. Spawn collision → `endGame()`.
- `clearLines()` owns level/speed updates (level = lines/10+1; interval = max(100, 1000-(level-1)*90)).
- Pause/game over work by `cancelAnimationFrame(animId)`; `togglePause` restarts `loop` manually.
- Abilities: `energy` (+25/line in `clearLines`, max 100) → `E` opens `#ability-menu` (cancels rAF like pause, `choosing` flag) → `useAbility(1-5)` via `ABILITIES` map; success zeroes energy. `queue` (≥6 pieces) replaces old `next`; `undoSnap` saved in `lockPiece`; slow time ticks in `loop` (`slowMs`).
- Rotation: `rotateCW` + kick offsets `[0,-1,1,-2,2]` in `tryRotate` (no SRS, no rotate-back-on-fail beyond skipping).
- Canvas pixel size is hardcoded in `index.html` (`300×600` = `COLS*BLOCK × ROWS*BLOCK`); change both if altering `COLS`/`ROWS`/`BLOCK`. Next-piece canvas is 120×120 (4×4 cells at 30px).
- Skins: `SKINS` map (`colors` + `draw(ctx,px,py,size,color,alpha)`); `COLORS` is a mutable `let` swapped by `applySkin()` (saves `localStorage 'skin'`, sets `data-skin`, redraws all canvases). `drawBlock` delegates to the active skin.
