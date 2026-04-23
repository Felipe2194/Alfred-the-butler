const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, screen, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');

// ─── Single instance lock ──────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [] }, null, 2));
    return { items: [] };
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { items: [] }; }
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// ─── State ─────────────────────────────────────────────────────────────────────
let tray        = null;
let alfredWin   = null;
let dashWin     = null;
let checkInterval  = null;
let randomTimeout  = null;
let walkInterval   = null;
let pauseTimeout   = null;

// ─── Walker ────────────────────────────────────────────────────────────────────
const ALFRED_W  = 120;
const ALFRED_H  = 220;
const WALK_TICK = 30;    // ms  (~33 fps)
const WALK_SPEED = 1.5;  // px/tick

let walker = {
  x: 0, dir: -1,
  targetX: 0,
  moving: false,   // empieza oculto; se activa después de load
  screenY: 0,
  minX: 0, maxX: 0,
};

function randomTarget() {
  // Zona aleatoria: evita los últimos 150px de cada borde (no llega siempre al extremo)
  const margin = 150;
  return walker.minX + margin + Math.floor(Math.random() * (walker.maxX - walker.minX - margin * 2));
}

// ─── Alfred window ─────────────────────────────────────────────────────────────
function createAlfredWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  walker.minX    = wa.x + 8;
  walker.maxX    = wa.x + wa.width - ALFRED_W - 8;
  walker.screenY = wa.y + wa.height - ALFRED_H;
  walker.x       = walker.maxX;          // posicion inicial (oculta hasta load)
  walker.targetX = randomTarget();
  walker.dir     = walker.targetX < walker.x ? -1 : 1;

  alfredWin = new BrowserWindow({
    width: ALFRED_W, height: ALFRED_H,
    x: Math.round(walker.x), y: walker.screenY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,          // ← oculto hasta que cargue; evita el Alfred fantasma blanco
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  alfredWin.loadFile(path.join(__dirname, 'renderer', 'alfred.html'));
  alfredWin.setAlwaysOnTop(true, 'screen-saver');

  alfredWin.webContents.once('did-finish-load', () => {
    alfredWin.show();
    walker.moving = true;
    alfredWin.webContents.send('set-dir', walker.dir);
    alfredWin.webContents.send('set-state', 'walk');
    startWalkLoop();
  });
}

// ─── Walk loop ─────────────────────────────────────────────────────────────────
function startWalkLoop() {
  if (walkInterval) clearInterval(walkInterval);

  walkInterval = setInterval(() => {
    if (!alfredWin || alfredWin.isDestroyed()) return;
    if (!walker.moving) return;

    // Avanzar hacia el target
    const diff = walker.targetX - walker.x;
    if (Math.abs(diff) <= WALK_SPEED) {
      // Llegó al destino → pausar
      walker.x = walker.targetX;
      walker.moving = false;
      alfredWin.setPosition(Math.round(walker.x), walker.screenY);
      alfredWin.webContents.send('set-state', 'idle');
      scheduleNextWalk();
    } else {
      walker.dir = diff > 0 ? 1 : -1;
      walker.x  += WALK_SPEED * walker.dir;
      alfredWin.setPosition(Math.round(walker.x), walker.screenY);
      alfredWin.webContents.send('walk-tick');
    }
  }, WALK_TICK);
}

function scheduleNextWalk() {
  if (pauseTimeout) clearTimeout(pauseTimeout);
  // Pausa aleatoria entre 3 y 8 segundos en cada destino
  const pause = 3000 + Math.random() * 5000;
  pauseTimeout = setTimeout(() => {
    if (!alfredWin || alfredWin.isDestroyed()) return;
    walker.targetX = randomTarget();
    walker.dir     = walker.targetX > walker.x ? 1 : -1;
    walker.moving  = true;
    alfredWin.webContents.send('set-dir', walker.dir);
    alfredWin.webContents.send('set-state', 'walk');
  }, pause);
}

// Pausa externa (al hablar) — retoma después de ms
function pauseWalking(ms) {
  if (pauseTimeout) clearTimeout(pauseTimeout);
  walker.moving = false;
  alfredWin?.webContents.send('set-state', 'idle');
  pauseTimeout = setTimeout(() => {
    if (!alfredWin || alfredWin.isDestroyed()) return;
    walker.targetX = randomTarget();
    walker.dir     = walker.targetX > walker.x ? 1 : -1;
    walker.moving  = true;
    alfredWin.webContents.send('set-dir', walker.dir);
    alfredWin.webContents.send('set-state', 'walk');
  }, ms);
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
function createDashWindow() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  dashWin = new BrowserWindow({
    width: 480, height: 620,
    x: wa.x + wa.width - 500, y: wa.y + wa.height - 660,
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  dashWin.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  dashWin.on('blur',   () => { if (dashWin && !dashWin.isDestroyed()) dashWin.close(); });
  dashWin.on('closed', () => { dashWin = null; });
}

// ─── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('LifeCheck — Alfred al servicio');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Panel', click: createDashWindow },
    { label: 'Mostrar/Ocultar Alfred', click: () => {
        alfredWin.isVisible() ? alfredWin.hide() : alfredWin.show();
    }},
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
  tray.on('click', createDashWindow);
}

// ─── Speak ─────────────────────────────────────────────────────────────────────
function speak(text) {
  if (!alfredWin || alfredWin.isDestroyed()) return;
  alfredWin.setAlwaysOnTop(true, 'screen-saver');
  alfredWin.webContents.send('speak', text);
  const ms = 5000 + text.split('\n').length * 1200;
  pauseWalking(ms);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function getDaysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const t     = new Date(dateStr); t.setHours(0,0,0,0);
  return Math.ceil((t - today) / 86400000);
}

// ─── Random phrases ────────────────────────────────────────────────────────────
const PHRASES = [
  (n) => `Everything alright, ${n}?`,
  (n) => `Do remember to stay hydrated, ${n}.`,
  (n) => `A gentleman is always prepared, ${n}.`,
  (n) => `Is there anything you need, ${n}?`,
  (n) => `At your service, as always, ${n}.`,
  (n) => `I trust today is going splendidly, ${n}.`,
  (n) => `Might I suggest a review of your schedule, ${n}?`,
  (n) => `A cup of tea would do you well, ${n}.`,
  (n) => `Have you reviewed your pending items today, ${n}?`,
  (n) => `A fine day to stay on top of things, ${n}.`,
];

function getSirName() {
  try {
    const d = loadData();
    return d.name ? d.name : 'sir';
  } catch { return 'sir'; }
}

function scheduleRandom() {
  const delay = (20 + Math.floor(Math.random() * 25)) * 60 * 1000;
  randomTimeout = setTimeout(() => {
    const fn = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    speak(fn(getSirName()));
    scheduleRandom();
  }, delay);
}

// ─── Startup greeting ──────────────────────────────────────────────────────────
function greetOnStartup() {
  const h    = new Date().getHours();
  const name = getSirName();
  const greeting = h < 12 ? `Good morning, ${name}.` :
                   h < 19 ? `Good afternoon, ${name}.` :
                              `Good evening, ${name}.`;
  setTimeout(() => speak(greeting), 2000);
}

// ─── Reminder notifications text ───────────────────────────────────────────────
function checkReminders() {
  const { items = [] } = loadData();
  const name  = getSirName();
  const urgent = items
    .filter(i => i.date && (() => { const d = getDaysUntil(i.date); return d < 0 || d <= (i.alertDays ?? 7); })())
    .map(i => ({ ...i, days: getDaysUntil(i.date) }));
  if (!urgent.length) return;

  const lines = urgent.map(i =>
    i.days < 0   ? `• ${i.name}: EXPIRED ${Math.abs(i.days)} day${Math.abs(i.days) !== 1 ? 's' : ''} ago` :
    i.days === 0 ? `• ${i.name}: DUE TODAY` :
                   `• ${i.name}: due in ${i.days} day${i.days !== 1 ? 's' : ''}`
  );

  new Notification({
    title: 'Alfred — LifeCheck',
    body:  lines.join('\n'),
    icon:  path.join(__dirname, 'assets', 'tray-icon.png'),
  }).show();

  speak(`${name}, a reminder:\n` + lines.join('\n'));
}

// ─── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-data',      ()        => loadData());
ipcMain.handle('save-data',     (_, data) => { saveData(data); return true; });
ipcMain.handle('open-dash',     ()        => createDashWindow());
ipcMain.handle('check-now',     ()        => checkReminders());
ipcMain.handle('get-data-path', ()        => DATA_FILE);
ipcMain.handle('update-name',   ()        => true); // name is read from file on next speak

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createAlfredWindow();
  createTray();
  greetOnStartup();
  setTimeout(checkReminders, 8000);
  checkInterval = setInterval(checkReminders, 60 * 60 * 1000);
  scheduleRandom();
});

app.on('second-instance', () => {
  // Si el usuario intenta abrir una segunda instancia, enfocar el dashboard
  createDashWindow();
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => {
  clearInterval(checkInterval);
  clearInterval(walkInterval);
  clearTimeout(randomTimeout);
  clearTimeout(pauseTimeout);
});
