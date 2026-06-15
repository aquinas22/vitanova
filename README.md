# 🌸 Vita Nova Charting

A simple, beautiful web app for charting your cycle with a **natural Catholic
method** — for Natural Family Planning (NFP), fully in line with the teaching of
the Church, and for women's health.

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
| `rules.html` | Full rules reference: the VDRS code, stickers, and family-planning guidance |
| `chart.html` | The charting tool (mobile-friendly; export to PDF from the ⋯ menu) |
| `js/charting.js` | Domain logic: discharge codes, Peak Day counting, automatic sticker assignment |
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

This is an independent educational charting aid, not medical advice, and is not
affiliated with or endorsed by any organization or method provider. To use a
natural method for family planning, learning it with a trained instructor is
strongly recommended.
