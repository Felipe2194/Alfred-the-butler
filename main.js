/**
 * LifeCheck — main.js
 * Electron main process: manages Alfred's window, walk loop,
 * system tray, reminders, and notifications.
 *
 * HOW TO CONTRIBUTE:
 *  - Add new reminder categories → edit dashboard.html (CAT_EMOJI map + select options)
 *  - Add new random phrases     → edit the PHRASES array below
 *  - Change walk behavior       → edit the Walker section
 *  - Add new IPC handlers       → add ipcMain.handle() calls near the bottom
 */

'use strict';

const {
  app, BrowserWindow, Tray, Menu,
  ipcMain, Notification, screen, nativeImage,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');

// ─── Single-instance guard ─────────────────────────────────────────────────────
// Prevents two Alfreds from running at the same time.
// A second launch focuses the dashboard instead.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ─── Data persistence ──────────────────────────────────────────────────────────
// All user data lives in one JSON file inside %APPDATA%/lifecheck/
// No database, no cloud — fully local and portable.
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [], name: '' }, null, 2));
      return { items: [], name: '' };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return { items: [], name: '' }; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getSirName() {
  try { const d = loadData(); return d.name || 'sir'; }
  catch { return 'sir'; }
}

// ─── Window references ─────────────────────────────────────────────────────────
let tray      = null;
let alfredWin = null;   // Transparent floating character window
let dashWin   = null;   // Dashboard popup

// ─── Timers ────────────────────────────────────────────────────────────────────
let walkInterval  = null;   // Move Alfred across screen
let pauseTimeout  = null;   // Pause between walk segments
let checkInterval = null;   // Hourly reminder check
let randomTimeout = null;   // Random butler quip timer

// ─── Walker config ─────────────────────────────────────────────────────────────
// To make Alfred faster/slower → change WALK_SPEED (px per tick)
// To reduce CPU usage further  → increase WALK_TICK (ms between ticks)
const ALFRED_W   = 120;   // Window width  (px)
const ALFRED_H   = 220;   // Window height (px) — extra room for speech bubble
const WALK_SPEED = 1.5;   // Pixels per tick
const WALK_TICK  = 50;    // 20 fps — smooth enough for pixel art, easy on CPU

let walker = {
  x: 0, y: 0,
  dir: -1,        // -1 = left, +1 = right
  targetX: 0,
  moving: false,
  minX: 0, maxX: 0,
};

/** Pick a random destination, avoiding the last 120px of each edge */
function randomTarget() {
  const margin = 120;
  const range  = walker.maxX - walker.minX - margin * 2;
  return walker.minX + margin + Math.floor(Math.random() * range);
}

// ─── Alfred window ─────────────────────────────────────────────────────────────
function createAlfredWindow() {
  const { workArea: wa, bounds } = screen.getPrimaryDisplay();

  // Walk across the full screen width; feet sit on the taskbar/dock top edge.
  // Math.round prevents sub-pixel drift that can push Alfred 1px into the taskbar.
  walker.minX = bounds.x + 8;
  walker.maxX = bounds.x + bounds.width - ALFRED_W - 8;
  walker.y    = Math.round(wa.y + wa.height - ALFRED_H);
  walker.x    = walker.maxX;
  walker.targetX = randomTarget();
  walker.dir  = -1;

  // On macOS the Dock has a higher z-order than normal windows, so Alfred would
  // disappear behind it. Using alwaysOnTop:true with level 'floating' keeps him
  // visible above the Dock while still letting modal dialogs cover him.
  // On Windows the taskbar is always-on-top regardless of our setting, so we
  // leave Alfred at the normal z-level so regular app windows cover him naturally.
  const isMac = process.platform === 'darwin';

  alfredWin = new BrowserWindow({
    width: ALFRED_W, height: ALFRED_H,
    x: Math.round(walker.x), y: Math.round(walker.y),
    transparent: true,
    frame: false,
    alwaysOnTop: isMac,   // macOS: float above Dock; Windows: normal z-level
    skipTaskbar: true,    // No taskbar/Dock button for Alfred
    resizable: false,
    hasShadow: false,
    show: false,          // Hidden until HTML is ready (prevents white-flash ghost)
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  // On macOS keep Alfred at the 'floating' level — above normal windows and the
  // Dock, but below full-screen apps and screen savers.
  if (isMac) alfredWin.setAlwaysOnTop(true, 'floating');

  alfredWin.loadFile(path.join(__dirname, 'renderer', 'alfred.html'));

  alfredWin.webContents.once('did-finish-load', () => {
    alfredWin.show();
    walker.moving = true;
    sendToAlfred('set-dir', walker.dir);
    sendToAlfred('set-state', 'walk');
    startWalkLoop();
  });
}

/** Safe IPC send — no-ops if window is gone */
function sendToAlfred(channel, data) {
  if (alfredWin && !alfredWin.isDestroyed())
    alfredWin.webContents.send(channel, data);
}

// ─── Walk loop ─────────────────────────────────────────────────────────────────
// Moves the Electron window position each tick. Sprite animation is handled
// entirely by CSS in alfred.html — no IPC needed per frame.
function startWalkLoop() {
  if (walkInterval) clearInterval(walkInterval);

  walkInterval = setInterval(() => {
    if (!alfredWin || alfredWin.isDestroyed() || !walker.moving) return;

    const diff = walker.targetX - walker.x;

    if (Math.abs(diff) <= WALK_SPEED) {
      // Arrived at destination → idle pause
      walker.x = walker.targetX;
      walker.moving = false;
      alfredWin.setPosition(Math.round(walker.x), Math.round(walker.y));
      sendToAlfred('set-state', 'idle');
      scheduleNextWalk();
      return;
    }

    // Only send direction change when it actually flips (not every tick)
    const newDir = diff > 0 ? 1 : -1;
    if (newDir !== walker.dir) {
      walker.dir = newDir;
      sendToAlfred('set-dir', walker.dir);
    }

    walker.x += WALK_SPEED * walker.dir;
    alfredWin.setPosition(Math.round(walker.x), Math.round(walker.y));
  }, WALK_TICK);
}

/** Wait 3–8 s at destination, then pick a new random target */
function scheduleNextWalk() {
  if (pauseTimeout) clearTimeout(pauseTimeout);
  pauseTimeout = setTimeout(() => {
    if (!alfredWin || alfredWin.isDestroyed()) return;
    walker.targetX = randomTarget();
    walker.dir     = walker.targetX > walker.x ? 1 : -1;
    walker.moving  = true;
    sendToAlfred('set-dir', walker.dir);
    sendToAlfred('set-state', 'walk');
  }, 3000 + Math.random() * 5000);
}

/** Pause walking for `ms` milliseconds (called while Alfred is speaking) */
function pauseWalking(ms) {
  if (pauseTimeout) clearTimeout(pauseTimeout);
  walker.moving = false;
  sendToAlfred('set-state', 'idle');
  pauseTimeout = setTimeout(() => {
    if (!alfredWin || alfredWin.isDestroyed()) return;
    walker.targetX = randomTarget();
    walker.dir     = walker.targetX > walker.x ? 1 : -1;
    walker.moving  = true;
    sendToAlfred('set-dir', walker.dir);
    sendToAlfred('set-state', 'walk');
  }, ms);
}

// ─── Alfred speaking ───────────────────────────────────────────────────────────
/**
 * Make Alfred show a speech bubble.
 * @param {string}  text    - Message text (newlines supported)
 * @param {boolean} urgent  - If true, Alfred rises above all open windows.
 *                            Use urgent=true for reminders, false for quips.
 */
function speak(text, urgent = false) {
  if (!alfredWin || alfredWin.isDestroyed()) return;
  const ms = 5000 + text.split('\n').length * 1200;

  if (urgent) {
    alfredWin.setAlwaysOnTop(true, 'screen-saver');
    sendToAlfred('speak', text);
    pauseWalking(ms);
    setTimeout(() => {
      if (alfredWin && !alfredWin.isDestroyed()) alfredWin.setAlwaysOnTop(false);
    }, ms + 500);
  } else {
    // Quiet quip — Alfred speaks only if user happens to be on the desktop
    sendToAlfred('speak', text);
    pauseWalking(ms);
  }
}

// ─── Dashboard window ──────────────────────────────────────────────────────────
function createDashWindow() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.focus(); return; }
  const { workArea: wa } = screen.getPrimaryDisplay();
  dashWin = new BrowserWindow({
    width: 480, height: 620,
    x: wa.x + wa.width - 500,
    y: wa.y + wa.height - 660,
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  dashWin.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  dashWin.on('blur',   () => { if (dashWin && !dashWin.isDestroyed()) dashWin.close(); });
  dashWin.on('closed', () => { dashWin = null; });
}

// ─── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('LifeCheck — Alfred at your service');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Dashboard',    click: createDashWindow },
    { label: 'Show / Hide Alfred', click: () =>
        alfredWin.isVisible() ? alfredWin.hide() : alfredWin.show() },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() },
  ]));
  tray.on('click', createDashWindow);
}

// ─── ntfy.sh phone notifications ──────────────────────────────────────────────
// No dependencies — uses Node's built-in https module.
// ntfy.sh is a free push-notification service; the user installs the ntfy app
// on their phone and subscribes to a self-chosen topic name.
//
// API: POST https://ntfy.sh/{topic}
//   Headers: Title, Priority (min/low/default/high/max), Tags (emoji shortcuts)
//   Body:    plain-text message
//
// topicOverride lets the Settings "Send Test" button test before saving.
function sendPhoneNotification(title, body, priority = 'default', topicOverride = null, tokenOverride = null) {
  const saved = loadData();
  const topic = (topicOverride || (saved.ntfyTopic || '')).trim();
  if (!topic) return Promise.resolve(false);

  const token = (tokenOverride !== null ? tokenOverride : (saved.ntfyToken || '')).trim();

  return new Promise(resolve => {
    const payload = Buffer.from(body, 'utf8');
    // HTTP headers are ASCII-only — strip any non-ASCII chars from title
    const safeTitle = title.replace(/[^\x00-\x7F]/g, '').trim() || 'Alfred';

    const headers = {
      'Title':          safeTitle,
      'Priority':       priority,
      'Tags':           priority === 'high' ? 'warning,bell' : 'bell',
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': payload.length,
    };

    // Bearer token — keeps your topic private so only you receive notifications
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = https.request(
      {
        hostname: 'ntfy.sh',
        port:     443,
        path:     `/${encodeURIComponent(topic)}`,
        method:   'POST',
        headers,
      },
      res => resolve(res.statusCode >= 200 && res.statusCode < 300)
    );
    req.on('error', err => {
      console.warn('[ntfy] notification failed:', err.message);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

// ─── Reminder check ────────────────────────────────────────────────────────────
function getDaysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

// ─── Recurring reminder helper ─────────────────────────────────────────────────
// If a recurring item's date is in the past, advance it to the next future
// occurrence. Mutates item.date in place; returns true if the date changed.
// Called in checkReminders() so the saved data always holds the next due date.
function advanceRecurring(item) {
  if (!item.recur || item.recur === 'none') return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = new Date(item.date + 'T00:00:00');
  if (d >= today) return false;  // not yet past — nothing to do
  const n = item.recurEvery || 1;
  while (d < today) {
    if (item.recur === 'years')  d.setFullYear(d.getFullYear() + n);
    if (item.recur === 'months') d.setMonth(d.getMonth() + n);
    if (item.recur === 'days')   d.setDate(d.getDate() + n);
  }
  item.date = d.toISOString().slice(0, 10);
  return true;
}

function checkReminders() {
  // Load the full data object so we can save back advanced recurring dates
  const data = loadData();
  const name = getSirName();

  // Auto-advance any past-due recurring items and persist the changes
  const changed = (data.items || []).reduce((acc, i) => advanceRecurring(i) || acc, false);
  if (changed) saveData(data);

  const items = data.items || [];

  const urgent = items.filter(i => {
    if (!i.date) return false;
    const d = getDaysUntil(i.date);
    return d < 0 || d <= (i.alertDays ?? 7);
  }).map(i => ({ ...i, days: getDaysUntil(i.date) }));

  if (!urgent.length) return;

  const lines = urgent.map(i =>
    i.days < 0   ? `• ${i.name}: EXPIRED ${Math.abs(i.days)}d ago` :
    i.days === 0 ? `• ${i.name}: DUE TODAY` :
                   `• ${i.name}: due in ${i.days}d`
  );

  new Notification({
    title: 'Alfred — LifeCheck',
    body:  lines.join('\n'),
    icon:  path.join(__dirname, 'assets', 'tray-icon.png'),
  }).show();

  speak(`${name}, a reminder:\n` + lines.join('\n'), true);

  // Phone notification — only fires if the user has configured an ntfy topic.
  // Priority is 'high' if any item is already expired or due today.
  const hasUrgent = urgent.some(i => i.days <= 0);
  sendPhoneNotification(
    'Alfred - Reminder',
    lines.join('\n'),
    hasUrgent ? 'high' : 'default'
  );
}

// ─── Random butler phrases ─────────────────────────────────────────────────────
// Add your own phrases here! Each entry is a function receiving the user's name.
const PHRASES = [
  n => `Everything alright, ${n}?`,
  n => `Do remember to stay hydrated, ${n}.`,
  n => `A gentleman is always prepared, ${n}.`,
  n => `Is there anything you need, ${n}?`,
  n => `At your service, as always, ${n}.`,
  n => `I trust today is going splendidly, ${n}.`,
  n => `Might I suggest a review of your schedule, ${n}?`,
  n => `A cup of tea would do you well, ${n}.`,
  n => `Have you reviewed your pending items today, ${n}?`,
  n => `A fine day to stay on top of things, ${n}.`,
];

function scheduleRandom() {
  // Fire every 20–45 minutes
  randomTimeout = setTimeout(() => {
    speak(PHRASES[Math.floor(Math.random() * PHRASES.length)](getSirName()));
    scheduleRandom();
  }, (20 + Math.floor(Math.random() * 25)) * 60 * 1000);
}

// ─── Startup greeting ──────────────────────────────────────────────────────────
function greetOnStartup() {
  const h = new Date().getHours();
  const name = getSirName();
  const greeting = h < 12 ? `Good morning, ${name}.` :
                   h < 19 ? `Good afternoon, ${name}.` :
                              `Good evening, ${name}.`;
  setTimeout(() => speak(greeting, true), 2000);
}

// ─── IPC handlers ──────────────────────────────────────────────────────────────
// Add new handlers here when adding features to the dashboard.
ipcMain.handle('get-data',      ()        => loadData());
ipcMain.handle('save-data',     (_, data) => { saveData(data); return true; });
ipcMain.handle('open-dash',     ()        => createDashWindow());
ipcMain.handle('check-now',     ()        => checkReminders());
ipcMain.handle('get-data-path', ()        => DATA_FILE);
ipcMain.handle('update-name',   ()        => true);
// Test button in Settings — sends a test notification to the given topic
// without requiring the user to save first.
ipcMain.handle('ntfy-test', (_, { topic, token }) =>
  sendPhoneNotification('Alfred - Test', 'Test successful! Alfred is ready to serve.', 'default', topic, token));

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Hide from macOS Dock — Alfred lives in the menu-bar tray, not the Dock.
  if (process.platform === 'darwin') app.dock?.hide();

  createAlfredWindow();
  createTray();
  greetOnStartup();
  setTimeout(checkReminders, 8000);                        // check 8s after startup
  checkInterval = setInterval(checkReminders, 3600000);    // then every hour
  scheduleRandom();
});

// Prevent app from quitting when all windows close — it lives in the tray
app.on('window-all-closed', e => e.preventDefault());

// Second launch → focus dashboard instead of opening a new instance
app.on('second-instance', createDashWindow);

app.on('before-quit', () => {
  clearInterval(walkInterval);
  clearInterval(checkInterval);
  clearTimeout(pauseTimeout);
  clearTimeout(randomTimeout);
});
