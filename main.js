/**
 * LifeCheck — main.js
 * Electron main process: manages Alfred's window, walk loop,
 * system tray, reminders, and notifications.
 *
 * HOW TO CONTRIBUTE:
 *  - Add new reminder categories → edit dashboard.html (CAT_EMOJI map + select options)
 *  - Add new random phrases     → edit the PHRASES array below
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
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ─── Data persistence ──────────────────────────────────────────────────────────
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
let alfredWin = null;
let dashWin   = null;

// ─── Timers ────────────────────────────────────────────────────────────────────
let checkInterval = null;
let randomTimeout = null;

// ─── Alfred dimensions ─────────────────────────────────────────────────────────
const ALFRED_W = 300;
const ALFRED_H = 340;

// ─── Multi-screen support ──────────────────────────────────────────────────────
// Returns the display most likely to have the taskbar (Windows: primary, or
// whichever has the largest workArea height difference from its total height).
function getTargetDisplay() {
  const displays = screen.getAllDisplays();
  if (displays.length === 1) return displays[0];
  return displays.reduce((best, d) => {
    const dWaste = d.bounds.height    - d.workArea.height;
    const bWaste = best.bounds.height - best.workArea.height;
    return dWaste > bWaste ? d : best;
  }, displays[0]);
}

// ─── Alfred window ─────────────────────────────────────────────────────────────
function createAlfredWindow() {
  const { workArea: wa } = getTargetDisplay();

  const x = Math.round(wa.x + wa.width  - ALFRED_W - 16);
  const y = Math.round(wa.y + wa.height - ALFRED_H);

  const isMac = process.platform === 'darwin';

  alfredWin = new BrowserWindow({
    width: ALFRED_W, height: ALFRED_H,
    x, y,
    transparent: true,
    frame: false,
    alwaysOnTop: isMac,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  if (isMac) alfredWin.setAlwaysOnTop(true, 'floating');

  // Transparent areas pass mouse events to windows underneath.
  // The renderer will disable this when the cursor is over a visible pixel.
  alfredWin.setIgnoreMouseEvents(true, { forward: true });

  alfredWin.loadFile(path.join(__dirname, 'renderer', 'alfred.html'));

  alfredWin.webContents.once('did-finish-load', () => {
    alfredWin.show();
    sendToAlfred('set-state', { state: 'idle' });
  });
}

/** Safe IPC send — no-ops if window is gone */
function sendToAlfred(channel, data) {
  if (alfredWin && !alfredWin.isDestroyed())
    alfredWin.webContents.send(channel, data);
}

// ─── Alfred speaking ───────────────────────────────────────────────────────────
/**
 * Make Alfred show a speech bubble.
 * Shows a brief "thinking" animation, then the message.
 *
 * @param {string}  text   - Message text (newlines supported)
 * @param {boolean} urgent - Rises above all windows while showing
 */
function speak(text, urgent = false) {
  if (!alfredWin || alfredWin.isDestroyed()) return;

  if (urgent) alfredWin.setAlwaysOnTop(true, 'screen-saver');

  // Brief thinking pause before the actual message
  sendToAlfred('think');
  setTimeout(() => sendToAlfred('speak', text), 800);

  if (urgent) {
    const safeMs = 800 + 5000 + text.split('\n').length * 1200 + 4000;
    setTimeout(() => {
      if (alfredWin && !alfredWin.isDestroyed()) alfredWin.setAlwaysOnTop(false);
    }, safeMs);
  }
}

// ─── Dashboard window ──────────────────────────────────────────────────────────
function createDashWindow() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.focus(); return; }
  const { workArea: wa } = getTargetDisplay();
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
    {
      label: 'Theme', submenu: [
        { label: 'Classic',  click: () => sendToAlfred('apply-theme', 'classic')  },
        { label: 'Midnight', click: () => sendToAlfred('apply-theme', 'midnight') },
        { label: 'Peach',    click: () => sendToAlfred('apply-theme', 'peach')    },
        { label: 'Cloud',    click: () => sendToAlfred('apply-theme', 'cloud')    },
        { label: 'Moss',     click: () => sendToAlfred('apply-theme', 'moss')     },
      ],
    },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() },
  ]));
  tray.on('click', createDashWindow);
}

// ─── ntfy.sh phone notifications ──────────────────────────────────────────────
function sendPhoneNotification(title, body, priority = 'default', topicOverride = null, tokenOverride = null) {
  const saved = loadData();
  const topic = (topicOverride || (saved.ntfyTopic || '')).trim();
  if (!topic) return Promise.resolve(false);

  const token = (tokenOverride !== null ? tokenOverride : (saved.ntfyToken || '')).trim();

  return new Promise(resolve => {
    const payload   = Buffer.from(body, 'utf8');
    const safeTitle = title.replace(/[^\x00-\x7F]/g, '').trim() || 'Alfred';

    const headers = {
      'Title':          safeTitle,
      'Priority':       priority,
      'Tags':           priority === 'high' ? 'warning,bell' : 'bell',
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': payload.length,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = https.request(
      { hostname: 'ntfy.sh', port: 443, path: `/${encodeURIComponent(topic)}`, method: 'POST', headers },
      res => resolve(res.statusCode >= 200 && res.statusCode < 300)
    );
    req.on('error', err => { console.warn('[ntfy] notification failed:', err.message); resolve(false); });
    req.write(payload);
    req.end();
  });
}

// ─── Reminder check ────────────────────────────────────────────────────────────
function getDaysUntil(dateStr) {
  const today  = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function advanceRecurring(item) {
  if (!item.recur || item.recur === 'none') return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = new Date(item.date + 'T00:00:00');
  if (d >= today) return false;
  const n = item.recurEvery || 1;
  while (d < today) {
    if (item.recur === 'years')  d.setFullYear(d.getFullYear() + n);
    if (item.recur === 'months') d.setMonth(d.getMonth() + n);
    if (item.recur === 'days')   d.setDate(d.getDate() + n);
  }
  item.date = d.toISOString().slice(0, 10);
  return true;
}

function getLastPhoneNotifyDate() {
  try { return loadData().lastPhoneNotifyDate || ''; } catch { return ''; }
}
function setLastPhoneNotifyDate(dateStr) {
  const d = loadData(); d.lastPhoneNotifyDate = dateStr; saveData(d);
}

function checkReminders() {
  const data    = loadData();
  const name    = getSirName();
  const changed = (data.items || []).reduce((acc, i) => advanceRecurring(i) || acc, false);
  if (changed) saveData(data);

  const items  = data.items || [];
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

  const today = new Date().toISOString().slice(0, 10);
  if (getLastPhoneNotifyDate() !== today) {
    setLastPhoneNotifyDate(today);
    const hasUrgent = urgent.some(i => i.days <= 0);
    sendPhoneNotification('Alfred - Reminder', lines.join('\n'), hasUrgent ? 'high' : 'default');
  }
}

// ─── Random butler phrases ─────────────────────────────────────────────────────
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
  n => `Some men just want to watch the world burn, ${n}.\nI, however, prefer order.`,
  n => `Know your limits, Master ${n}.`,
  n => `Why do we fall, ${n}?\nSo that we can learn to pick ourselves up.`,
  n => `Can I persuade you to take a sandwich with you, sir?`,
  n => `You are as stubborn as your father, ${n}.\nI mean that as a compliment.`,
  n => `The suit is pressed and ready, ${n}.\nShould you require it.`,
  n => `I have prepared the car, ${n}.\nNot that you asked.`,
  n => `Endure, Master ${n}.\nTake it. They'll hate you for it,\nbut that's the point.`,
  n => `If you're not too busy saving the world,\nyour reminders await, ${n}.`,
  n => `Even the strongest man needs rest, ${n}.\nAnd perhaps a sandwich.`,
];

function scheduleRandom() {
  randomTimeout = setTimeout(() => {
    speak(PHRASES[Math.floor(Math.random() * PHRASES.length)](getSirName()));
    scheduleRandom();
  }, (20 + Math.floor(Math.random() * 25)) * 60 * 1000);
}

// ─── Startup greeting ──────────────────────────────────────────────────────────
function greetOnStartup() {
  const h    = new Date().getHours();
  const name = getSirName();
  const greeting = h < 12 ? `Good morning, ${name}.` :
                   h < 19 ? `Good afternoon, ${name}.` :
                              `Good evening, ${name}.`;
  setTimeout(() => speak(greeting, true), 2000);
}

// ─── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-data',      ()        => loadData());
ipcMain.handle('save-data',     (_, data) => { saveData(data); return true; });
ipcMain.handle('open-dash',     ()        => createDashWindow());
ipcMain.handle('check-now',     ()        => checkReminders());
ipcMain.handle('get-data-path', ()        => DATA_FILE);
ipcMain.handle('update-name',   ()        => true);
ipcMain.handle('ntfy-test', (_, { topic, token }) =>
  sendPhoneNotification('Alfred - Test', 'Test successful! Alfred is ready to serve.', 'default', topic, token));

// Pixel-perfect hit detection — renderer tells us when cursor is over a visible pixel.
// setIgnoreMouseEvents(true, { forward: true }) lets mousemove fire in the renderer
// even while clicks pass through, so the renderer can keep checking position.
ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (alfredWin && !alfredWin.isDestroyed())
    alfredWin.setIgnoreMouseEvents(ignore, { forward: true });
});

// Renderer signals when the speech bubble auto-closes.
ipcMain.on('bubble-closed', () => { /* reserved for future use */ });

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  createAlfredWindow();
  createTray();
  greetOnStartup();
  setTimeout(checkReminders, 8000);
  checkInterval = setInterval(checkReminders, 3600000);
  scheduleRandom();
});

app.on('window-all-closed', e => e.preventDefault());
app.on('second-instance', createDashWindow);

app.on('before-quit', () => {
  clearInterval(checkInterval);
  clearTimeout(randomTimeout);
});
