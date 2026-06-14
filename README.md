# 🌸 Vita Nova Charting

A simple, beautiful web app for charting your cycle with the **Creighton Model
FertilityCare System (CrMS)** — for natural family planning and women's health.

It's a static web app (plain HTML/CSS/JavaScript, no build step). Your chart is
saved **locally in your browser**, so it works instantly, offline, and privately
— no account required. Optional cloud sync (Firebase) is available if you want
your chart on multiple devices.

## Running it

```bash
./run.sh           # serve on port 8080
./run.sh 9000      # custom port
```

Then open the printed address. On a Raspberry Pi the script prints both the
local URL and the LAN URL (e.g. `http://10.0.0.21:8080/`) so you can reach it
from your phone or laptop on the same network.

Any static server works too — e.g. `python3 -m http.server`.

### Auto-start on a Raspberry Pi (optional)

To keep it running and start on boot, create a systemd service:

```bash
sudo tee /etc/systemd/system/vita-nova.service >/dev/null <<EOF
[Unit]
Description=Vita Nova Charting
After=network.target

[Service]
WorkingDirectory=$HOME/charting-app
ExecStart=/usr/bin/python3 -m http.server 8080 --bind 0.0.0.0
Restart=always
User=$USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now vita-nova
```

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | Landing page + educational content (what it is, health benefits, the rules) |
| `chart.html` | The charting tool |
| `js/creighton.js` | Domain logic: VDRS codes, Peak Day counting, automatic sticker assignment |
| `js/store.js` | Local-first storage + optional, lazy Firebase cloud sync |
| `js/chart-app.js` | Chart UI controller |
| `js/firebase-config.js` | Firebase project config (only loaded if you sign in) |
| `css/style.css` | The design system |
| `run.sh` | Local web server |

## Data & privacy

- Your chart lives in your browser's `localStorage`.
- **Export / import / reset** are available from the **⋯** menu on the chart page.
- Cloud sync is off until you choose **Sign in to sync**. It's lazy-loaded, so
  if Firebase is unreachable the app still works fully offline.

## Disclaimer

This is an educational charting aid, not medical advice, and is not affiliated
with or endorsed by the Pope Paul VI Institute or Creighton University. To use
the Creighton Model for family planning, learning it with a certified
FertilityCare Practitioner is strongly recommended.
