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
let energy, previewLeft, slowMs, held, holdReady, undoSnap, choosing;
let startLevel = 1, runStartLevel = 1; // runStartLevel: fijo durante la partida

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
    level = Math.max(runStartLevel, Math.floor(lines / 10) + 1);
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
    score, lines, level, dropInterval,
  };
  merge();
  clearLines();
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
}

// ---- Pause menu ----
const pauseMenu = document.getElementById('pause-menu');
const pauseMain = document.getElementById('pause-main');
const pauseControls = document.getElementById('pause-controls');
const startLevelSel = document.getElementById('start-level');

function togglePause() {
  if (gameOver || choosing) return;
  paused = !paused;
  if (paused) {
    cancelAnimationFrame(animId);
    pauseMain.classList.remove('hidden');
    pauseControls.classList.add('hidden');
    startLevelSel.value = startLevel;
    pauseMenu.classList.remove('hidden');
  } else {
    pauseMenu.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();
    dropAccum = 0;
    lastTime = performance.now();
    loop(lastTime);
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
  runStartLevel = startLevel;
  level = runStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  energy = 0;
  previewLeft = 0;
  slowMs = 0;
  held = null;
  holdReady = false;
  undoSnap = null;
  choosing = false;
  queue = [];
  fillQueue();
  spawn();
  drawHold();
  updateHUD();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  abilityMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.repeat && (paused || e.code === 'Escape' || e.code === 'KeyP')) return;
  if (paused) {
    // menu abierto: solo P/Esc, el resto no llega al juego
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    return;
  }
  if (choosing) {
    if (e.code === 'Escape') closeAbilityMenu();
    else if (/^(Digit|Numpad)[1-5]$/.test(e.code)) useAbility(e.code.slice(-1));
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
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

restartBtn.addEventListener('click', init);

document.getElementById('pause-resume').addEventListener('click', togglePause);
document.getElementById('pause-restart').addEventListener('click', () => {
  if (document.activeElement) document.activeElement.blur();
  init();
});
document.getElementById('pause-controls-btn').addEventListener('click', () => {
  pauseControls.classList.toggle('hidden');
});
startLevelSel.addEventListener('change', () => {
  startLevel = parseInt(startLevelSel.value, 10) || 1;
  startLevelSel.blur();
});

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

init();

let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch (e) {}
applyTheme(savedTheme === 'light' ? 'light' : 'dark');
