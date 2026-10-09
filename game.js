'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - light blue
  '#ffb74d', // L - orange
  '#b0bec5', // Screw - silver
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Screw
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const ENERGY_MAX = 100;
const ENERGY_PER_LINE = 25;
const PREVIEW_PIECES = 10; // spawns the 5-piece preview stays active
const PREVIEW_COUNT = 5;
const SLOW_MS = 10000;
const SLOW_FACTOR = 2;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');
const energyFill = document.getElementById('energy-fill');
const abilityStatus = document.getElementById('ability-status');
const abilityMenu = document.getElementById('ability-menu');
const holdSection = document.getElementById('hold-section');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const queueSection = document.getElementById('queue-section');
const queueCanvas = document.getElementById('queue-canvas');
const queueCtx = queueCanvas.getContext('2d');

let board, current, queue, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, bestCombo; // consecutive line-clearing locks / best this game
let energy, previewLeft, slowMs, held, holdReady, undoSnap, choosing;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return makePiece(Math.floor(Math.random() * (PIECES.length - 1)) + 1);
}

function fillQueue() {
  while (queue.length < PREVIEW_COUNT + 1) queue.push(randomPiece());
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    energy = Math.min(ENERGY_MAX, energy + cleared * ENERGY_PER_LINE);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  undoSnap = {
    board: board.map(r => [...r]),
    type: current.type,
    score, lines, level, dropInterval, combo,
  };
  const linesBefore = lines;
  merge();
  clearLines();
  trackCombo(lines > linesBefore);
  spawn();
}

function spawn() {
  current = queue.shift();
  fillQueue();
  if (previewLeft > 0) previewLeft--;
  if (collide(current.shape, current.x, current.y)) {
    // keep only the cells that fit in free board spaces
    current.shape = current.shape.map((row, r) =>
      row.map((v, c) => (v && !collide([[v]], current.x + c, current.y + r) ? v : 0)));
    endGame();
  }
  drawNext();
  drawQueue();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  energyFill.style.width = `${(energy / ENERGY_MAX) * 100}%`;
  energyFill.classList.toggle('ready', energy >= ENERGY_MAX);
  if (slowMs > 0) abilityStatus.textContent = `Lento ${Math.ceil(slowMs / 1000)}s`;
  else abilityStatus.textContent = energy >= ENERGY_MAX ? 'Pulsa E' : '';
}

// ---- Abilities ----
const ABILITIES = {
  1: abilityPreview,
  2: abilitySwap,
  3: abilitySlow,
  4: abilityUndo,
  5: abilityHold,
};

function abilityPreview() {
  previewLeft = PREVIEW_PIECES + 1; // +1: current spawn decrement already happened
  drawQueue();
  return true;
}

function abilitySwap() {
  let type;
  do {
    type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  } while (type === current.type);
  const shape = PIECES[type].map(row => [...row]);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collide(shape, current.x + kick, current.y)) {
      current = { type, shape, x: current.x + kick, y: current.y };
      return true;
    }
  }
  return false;
}

function abilitySlow() {
  slowMs = SLOW_MS;
  return true;
}

function abilityUndo() {
  if (!undoSnap) return false;
  board = undoSnap.board;
  score = undoSnap.score;
  lines = undoSnap.lines;
  level = undoSnap.level;
  dropInterval = undoSnap.dropInterval;
  combo = undoSnap.combo;
  queue.unshift(makePiece(current.type));
  current = makePiece(undoSnap.type);
  undoSnap = null;
  drawNext();
  drawQueue();
  return true;
}

function abilityHold() {
  if (held) return false;
  held = makePiece(current.type);
  holdReady = true;
  spawn();
  drawHold();
  return true;
}

function useHeld() {
  if (!holdReady || !held) return;
  queue.unshift(makePiece(current.type));
  current = makePiece(held.type);
  held = null;
  holdReady = false;
  if (collide(current.shape, current.x, current.y)) endGame();
  drawHold();
  drawNext();
  drawQueue();
}

function openAbilityMenu() {
  if (energy < ENERGY_MAX || paused || gameOver || choosing) return;
  choosing = true;
  cancelAnimationFrame(animId);
  abilityMenu.querySelector('[data-ability="4"]').disabled = !undoSnap;
  abilityMenu.querySelector('[data-ability="5"]').disabled = !!held;
  abilityMenu.classList.remove('hidden');
}

function closeAbilityMenu() {
  if (!choosing) return;
  choosing = false;
  abilityMenu.classList.add('hidden');
  lastTime = performance.now();
  loop(lastTime);
}

function useAbility(id) {
  const fn = ABILITIES[id];
  if (!choosing || !fn || !fn()) return;
  energy = 0;
  updateHUD();
  closeAbilityMenu();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  if (!gameOver) {
    const gy = ghostY();
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);
  }

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// draws a piece centered in a 4x4-cell slot at (slotX, slotY) cells
function drawPieceInSlot(context, shape, size, slotX, slotY) {
  const offX = slotX + Math.floor((4 - shape[0].length) / 2);
  const offY = slotY + Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(context, offX + c, offY + r, shape[r][c], size);
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  drawPieceInSlot(nextCtx, queue[0].shape, 30, 0, 0);
}

function drawQueue() {
  queueSection.classList.toggle('hidden', previewLeft <= 0);
  queueCtx.clearRect(0, 0, queueCanvas.width, queueCanvas.height);
  if (previewLeft <= 0) return;
  for (let i = 0; i < PREVIEW_COUNT; i++)
    drawPieceInSlot(queueCtx, queue[i].shape, 15, 0, i * 4);
}

function drawHold() {
  holdSection.classList.toggle('hidden', !held);
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (held) drawPieceInSlot(holdCtx, held.shape, 30, 0, 0);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  showGameOverScores();
}

function togglePause() {
  if (gameOver || choosing) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (slowMs > 0) {
    slowMs = Math.max(0, slowMs - dt);
    updateHUD();
  }
  if (dropAccum >= dropInterval * (slowMs > 0 ? SLOW_FACTOR : 1)) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  energy = 0;
  previewLeft = 0;
  slowMs = 0;
  held = null;
  holdReady = false;
  undoSnap = null;
  choosing = false;
  resetRunStats();
  queue = [];
  fillQueue();
  spawn();
  drawHold();
  updateHUD();
  overlay.classList.add('hidden');
  abilityMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // typing in the name field / start screen: game keys must not fire
  if (e.target instanceof HTMLInputElement || !startOverlay.classList.contains('hidden')) return;
  if (choosing) {
    if (e.code === 'Escape') closeAbilityMenu();
    else if (/^(Digit|Numpad)[1-5]$/.test(e.code)) useAbility(e.code.slice(-1));
    return;
  }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'KeyE':
      openAbilityMenu();
      return;
    case 'KeyC':
      useHeld();
      break;
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

// ---- High scores ----
const HS_KEY = 'tetris-highscores';
const REC_KEY = 'tetris-records';
const HS_MAX = 5;
const NAME_MAX = 12;
const DEFAULT_NAME = 'Jugador';

const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const hsEntry = document.getElementById('hs-entry');
const hsName = document.getElementById('hs-name');
const hsSave = document.getElementById('hs-save');
const overlayScores = document.getElementById('overlay-scores');

let pendingRank = -1; // rank of the unsaved game-over score, -1 = none
const memStore = {};  // fallback when localStorage is unavailable

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (v != null) return v;
  } catch (e) {
    if (key in memStore) return memStore[key];
  }
  return fallback;
}

function saveJSON(key, value) {
  memStore[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function loadScores() {
  const list = loadJSON(HS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && typeof x.score === 'number').slice(0, HS_MAX);
}

function loadRecords() {
  const r = loadJSON(REC_KEY, null) || {};
  return { bestCombo: +r.bestCombo || 0, maxLines: +r.maxLines || 0 };
}

// index where `sc` would enter the list (ties go after), -1 if it doesn't make top
function rankFor(list, sc) {
  if (sc <= 0) return -1;
  let i = list.findIndex(x => sc > x.score);
  if (i < 0) i = list.length;
  return i < HS_MAX ? i : -1;
}

function trackCombo(cleared) {
  combo = cleared ? combo + 1 : 0;
  if (combo > bestCombo) bestCombo = combo;
}

function resetRunStats() {
  combo = 0;
  bestCombo = 0;
  pendingRank = -1;
  hsEntry.classList.add('hidden');
  overlayScores.classList.add('hidden');
}

function cell(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function renderTable(box, list, hi) {
  box.textContent = '';
  if (!list.length) { box.appendChild(cell('p', 'Sin récords todavía', 'hs-empty')); return; }
  const table = document.createElement('table');
  table.className = 'hs-table';
  const head = table.insertRow();
  ['#', 'Nombre', 'Puntos', 'Líneas', 'Combo'].forEach(t => head.appendChild(cell('th', t)));
  list.forEach((x, i) => {
    const tr = table.insertRow();
    if (i === hi) tr.className = 'highlight';
    [i + 1, x.name || DEFAULT_NAME, x.score.toLocaleString(), x.lines || 0, x.combo || 0]
      .forEach(t => tr.appendChild(cell('td', t)));
  });
  box.appendChild(table);
}

// refresh all tables; hi = row to highlight on the game-over table (-1 none)
function renderScores(hi = -1) {
  const list = loadScores();
  let shown = list;
  if (pendingRank >= 0) { // preview the unsaved entry
    shown = list.slice();
    shown.splice(pendingRank, 0, { name: '(tú)', score, lines, combo: bestCombo });
    shown.length = Math.min(shown.length, HS_MAX);
    hi = pendingRank;
  }
  document.querySelectorAll('.hs-table-box').forEach(box => {
    const onStart = !!box.closest('#start-overlay');
    renderTable(box, onStart ? list : shown, onStart ? -1 : hi);
  });
  const r = loadRecords();
  document.querySelectorAll('.hs-records').forEach(el => {
    el.textContent = `Mejor combo: ${r.bestCombo} · Máx. líneas: ${r.maxLines}`;
  });
}

function showStart() {
  init();
  cancelAnimationFrame(animId);
  renderScores();
  startOverlay.classList.remove('hidden');
  startBtn.focus();
}

function showGameOverScores() {
  const rec = loadRecords();
  rec.bestCombo = Math.max(rec.bestCombo, bestCombo);
  rec.maxLines = Math.max(rec.maxLines, lines);
  saveJSON(REC_KEY, rec);
  pendingRank = rankFor(loadScores(), score);
  overlayScores.classList.remove('hidden');
  hsEntry.classList.toggle('hidden', pendingRank < 0);
  hsName.value = DEFAULT_NAME;
  renderScores();
  // delay so keys still held (Space spam) don't land in the field
  if (pendingRank >= 0) setTimeout(() => { if (pendingRank >= 0) { hsName.focus(); hsName.select(); } }, 400);
}

function saveEntry() {
  if (pendingRank < 0) return;
  const list = loadScores();
  const rank = rankFor(list, score);
  pendingRank = -1;
  hsEntry.classList.add('hidden');
  if (rank >= 0) {
    list.splice(rank, 0, {
      name: hsName.value.trim().slice(0, NAME_MAX) || DEFAULT_NAME,
      score, lines, combo: bestCombo,
      date: new Date().toISOString().slice(0, 10),
    });
    saveJSON(HS_KEY, list.slice(0, HS_MAX));
  }
  renderScores(rank);
}

startBtn.addEventListener('click', () => {
  startOverlay.classList.add('hidden');
  startBtn.blur();
  init();
});

hsSave.addEventListener('click', saveEntry);
hsName.addEventListener('keydown', e => { if (e.key === 'Enter') saveEntry(); });

document.querySelectorAll('.hs-reset').forEach(btn => btn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los récords?')) return;
  saveJSON(HS_KEY, []);
  saveJSON(REC_KEY, { bestCombo: 0, maxLines: 0 });
  pendingRank = -1;
  hsEntry.classList.add('hidden');
  renderScores();
  btn.blur();
}));

restartBtn.addEventListener('click', () => { saveEntry(); init(); });

abilityMenu.addEventListener('click', e => {
  const btn = e.target.closest('[data-ability]');
  if (btn && !btn.disabled) useAbility(btn.dataset.ability);
  else if (e.target.id === 'ability-cancel') closeAbilityMenu();
  if (btn) btn.blur();
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
  try { localStorage.setItem('theme', theme); } catch (e) {}
  // the loop is cancelled while paused / game over, so redraw explicitly
  draw();
  drawNext();
  drawQueue();
  drawHold();
}

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  themeBtn.blur();
});

showStart();

let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch (e) {}
applyTheme(savedTheme === 'light' ? 'light' : 'dark');
