# LifeCheck

**Alfred, your pixel-art butler, lives on your desktop and makes sure you never forget anything important.**

Driver's license expiring? Gym membership running out? Car inspection due? Birthday coming up? Alfred will let you know — before it's too late.

---

![Alfred walking on your desktop](assets/alfred.png)

---

## What is LifeCheck?

LifeCheck is a lightweight Windows desktop companion that sits at the bottom of your screen as a walking pixel-art butler named Alfred. He wanders your desktop, greets you by name, and reminds you of upcoming deadlines through speech bubbles and Windows notifications.

No cloud. No account. No subscriptions. Everything is stored locally on your machine.

---

## Features

- **Pixel-art Alfred** walks across the bottom of your screen at all times
- **Speech bubbles** appear when Alfred has something to tell you
- **Windows notifications** for urgent and expiring items
- **Personalized greetings** — Alfred addresses you by name, morning, afternoon, and evening
- **Random butler quips** — Alfred checks in on you every 20–45 minutes
- **Always on top** — when something is urgent, Alfred rises above all open windows
- **System tray** — lives quietly in the taskbar, never cluttering your screen
- **Dashboard** — clean dark UI to manage all your reminders
- **Fully local** — all data stored in a JSON file on your machine, zero telemetry

---

## What Alfred tracks

| Category | Examples |
|---|---|
| 📄 **Documents** | Passport, National ID, driver's license |
| 🚗 **Vehicle** | Car inspection (MOT/ITV), oil change, registration |
| 💊 **Health / Gym** | Gym membership, medical appointments |
| 🎂 **Birthdays** | Family, friends, anyone important |
| 💳 **Subscriptions / Bills** | Netflix, Spotify, insurance, rent |
| 📌 **Other** | Anything else you don't want to forget |

For each item you set:
- A **due date**
- How many **days in advance** Alfred warns you (1, 3, 7, 14, 30, or 60 days)
- An optional **note**

---

## Installation

### Requirements
- Windows 10 / 11
- [Node.js](https://nodejs.org) v18 or later

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/felipegiovanardi/LifeCheck.git
cd LifeCheck

# 2. Install dependencies
npm install

# 3. Start
npm start
```

Alfred will appear in the bottom-right corner and start walking. Click on him or his tray icon to open the dashboard.

---

## Usage

### Adding a reminder
1. Click Alfred or the tray icon
2. Go to the **+ Add** tab
3. Fill in the name, category, due date, and advance notice
4. Hit **Save**

### Editing or deleting
Click any item card to edit it. A **Delete** button appears at the bottom of the edit form.

### Personalizing Alfred
Go to **Settings** tab → enter your name → Save. Alfred will greet you by name from then on.

### Closing the app
Right-click the tray icon → **Exit**. Do not close from Task Manager — Alfred won't say goodbye properly.

---

## Project structure

```
LifeCheck/
├── main.js                 # Electron main process — windows, tray, walker, notifications
├── renderer/
│   ├── alfred.html         # Alfred floating window — sprites + bubble
│   └── dashboard.html      # Reminder dashboard — 4 tabs
├── assets/
│   ├── alfred.png          # Idle sprite (pixel art)
│   ├── alfred-walk.png     # Walk sprite (pixel art)
│   └── tray-icon.png       # System tray icon
├── process-sprites.js      # Utility: remove backgrounds from sprites
└── generate-icon.js        # Utility: generate tray icon PNG
```

Data is stored at:
```
%APPDATA%\lifecheck\data.json
```

---

## Inspiration

Inspired by [lil-agents](https://github.com/ryanstephen/lil-agents) — a macOS app where AI agent characters walk across your Dock. LifeCheck brings that same desktop companion energy to Windows, focused on keeping your real life organized instead of running AI sessions.

---

## Contributing

Pull requests are welcome. If you have ideas for new categories, reminder types, or Alfred animations — open an issue or send a PR.

Some ideas for the future:
- Yearly recurrence for birthdays and subscriptions
- Alfred walking sound effects
- Multiple reminder types (one-time vs. recurring)
- macOS support via Electron

---

## License

MIT — do whatever you want with it, just don't make Alfred work overtime.

---

*"I have been, and always shall be, at your service."*
*— Alfred*
