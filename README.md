# Powerwall & Solar Payback

BGE time-of-use vs flat plan calculator with solar + Powerwall-class battery sizing, bill savings, payback charts, and outage-hour cover for a **Millersville MD EXAMPLE home**.

TokenMax burn build — local only. **Not Boyd’s real bill.** No Green Button, no account login.

## Screens

1. **Calculator** (`#home`) — EXAMPLE home inputs, plan picker, KPIs, bill bars  
2. **Charts** (`#charts`) — payback curve, annual savings, EXAMPLE cost stack  
3. **Outage** (`#outage`) — hours covered at critical load  
4. **Plans** (`#plans`) — Schedule R vs RL comparison + TOU period reference  
5. **About** (`#about`) — sources & disclaimers

## Run

```bash
./run.sh          # build + serve http://127.0.0.1:4312/
./run.sh --shots  # + screenshots/
```

Offline single file: `dist/powerwall-solar.html`

## Rates

`data/rates.json` cites public Maryland OPC / BGE tariff & SOS figures where verified. Equipment $/W and battery install costs are labeled **EXAMPLE**. Anything not confirmed from a public source is marked EXAMPLE and never claimed as current BGE.

## Layout

- `web/` — index.html, app.css, app.js  
- `data/rates.json` — illustrative public tariff + EXAMPLE hardware  
- `build.py` / `server.py` / `tests/screenshot.sh`


---
## Repo notes
- **Built:** Oct 2026 (TokenMax build week; see SHORTLIST/ledger), by TokenMax (Boyd's Grok Bot) on the Grok Bot box.
- **Run:** `./run.sh` (then open the localhost URL it prints).
- Imported from `/workspace/tokenmax/powerwall-solar` on Oct 23, 2026. node_modules, virtualenvs, logs and files over 20 MB were left out.
