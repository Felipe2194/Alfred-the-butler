# Alfred your Butler

![Alfred walking on your desktop](assets/alfred.png)

A pixel-art butler named Alfred who lives on your Windows desktop and makes sure you never forget anything important.

Driver's license expiring? Car inspection due? Gym membership running out? Birthday coming up? Alfred walks across your screen, greets you by name, and tells you before it's too late.

## what it does

- Alfred walks back and forth at the bottom of your screen — always visible, never intrusive
- Speech bubbles appear when he has something to tell you
- Windows notifications for urgent and expiring items
- Greets you by name at startup (morning, afternoon, or evening)
- Drops random butler quips every 20–45 minutes
- Rises above all open windows when something needs attention
- Lives in the system tray when you don't need the dashboard
- All data stored locally — no cloud, no account, no telemetry

## what Alfred tracks

| | category | examples |
|---|---|---|
| 📄 | Document | Passport, national ID, driver's license |
| 🚗 | Vehicle | Car inspection, oil change, registration |
| 💊 | Health / Gym | Gym membership, medical appointments |
| 🎂 | Birthday | Family, friends |
| 💳 | Subscription / Bill | Netflix, Spotify, insurance |
| 📌 | Other | Anything you don't want to forget |

For each reminder you set a due date, how many days in advance Alfred warns you, and an optional note.

## requirements

- Windows 10 / 11
- [Node.js](https://nodejs.org) v18 or later

## installation

```bash
git clone https://github.com/felipegiovanardi/LifeCheck.git
cd LifeCheck
npm install
npm link
```

Then from any terminal:

```
hi alfred
```

Alfred appears in the bottom-right corner and starts walking.

## usage

**Adding a reminder** — click Alfred or the tray icon → **+ Add** tab → fill in the details → Save

**Editing or deleting** — click any item card in the dashboard to edit it

**Personalizing** — go to **Settings** tab → enter your name → Alfred will use it from then on

**Closing** — right-click the tray icon → Exit

## how the command works

`npm link` registers a global `hi` command on your system. Running `hi alfred` launches the Electron app from anywhere in your terminal with a small ASCII splash screen. If Alfred is already running, a second instance won't open.

To unregister the command at any time:

```bash
npm unlink -g lifecheck
```

## project structure

```
LifeCheck/
├── main.js                 # main process — walker, tray, notifications
├── bin/hi.js               # CLI entry point for 'hi alfred'
├── renderer/
│   ├── alfred.html         # floating Alfred window — sprites + bubble
│   └── dashboard.html      # dashboard — Today / All / Add / Settings
├── assets/
│   ├── alfred.png          # idle sprite
│   ├── alfred-walk.png     # walk sprite
│   └── tray-icon.png       # system tray icon
└── process-sprites.js      # utility: strip backgrounds from sprites
```

Data is saved at `%APPDATA%\lifecheck\data.json`.

## privacy

LifeCheck runs entirely on your machine and sends nothing anywhere.

- **Your data stays local.** Reminders are stored in a JSON file on your computer. Nothing is uploaded, synced, or shared.
- **No accounts.** No login, no user database, no analytics.
- **No telemetry.** The app never phones home.

## tech stack

| Layer | Technology | Why |
|---|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) v41 | Cross-platform native window, tray, notifications |
| UI | Vanilla HTML + CSS + JS | Zero dependencies, zero build step, easy to read and extend |
| Animations | Pure CSS `@keyframes` | No animation library — runs on the GPU compositor thread, zero JS overhead |
| Data storage | JSON file via Node.js `fs` | No database — a single human-readable file in `%APPDATA%` |
| CLI command | Node.js `bin` + `npm link` | `hi alfred` works from any terminal after one setup command |
| Sprite processing | [Jimp](https://github.com/jimp-dev/jimp) *(dev only)* | One-time background removal from PNG sprites; not included in the runtime |

**Zero runtime dependencies.** Electron is the only install. The app is ~50 MB on disk (mostly Electron's Chromium engine) and uses ~80 MB RAM at idle.

## inspiration

Inspired by [lil-agents](https://github.com/ryanstephen/lil-agents) — AI companions that walk across your macOS Dock. LifeCheck brings the same desktop companion idea to Windows, focused on keeping your real life organized instead of running AI sessions.

## license

Do whatever you want with it.

---

*"I have been, and always shall be, at your service."*
