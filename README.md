# Warframe Price Tracker (beta)

An unofficial fan-made price tracker. Price trends for prime Warframes and prime primary, secondary and melee weapons (full sets and every part and blueprint), built on the [warframe.market](https://warframe.market) public API.

warframe.market shows current orders, but its price history stopped updating in August 2026 (the v1 statistics API is deprecated). This project keeps its own history: a GitHub Actions job checks the price of about 700 prime items each hour, saves the numbers in this repo, and a GitHub Pages site shows them as a wall of cards with 90-day charts, with Near lows, Rising and My items (Owned, Tracking) views plus tabs for Warframes, Primary, Secondary and Melee, and Sets / Parts.

> **Beta.** Version `0.5.0-beta`. Layout, data format and numbers may change, and early averages are based on only a few days of data. The page is marked `noindex` so search engines skip it while it's in beta.

## How it works

```
every hour at :17 (UTC)
  GitHub Actions ──► collector/collect.py ──► warframe.market API
                          │
                          ├─► data/history/YYYY-MM.csv   one row per item per hour
                          ├─► data/latest.json           summary the page reads
                          └─► Discord alert (optional)
                          │
                     commit to this repo ──► GitHub Pages serves index.html
```

- **Price** = lowest sell listing; **top buy** = highest buy order. Both come from the item's top orders.
- **Averages** (7 and 30 days) are averages of each day's median lowest-sell price, shown once there are at least 3 days of data.
- **Change %** compares the current lowest sell with the 30-day average. Blue means cheaper than usual, orange means pricier.
- **Charts** cover the last 90 days and show their date range, the high and low, and the price on the day you hover. Days before 14 Oct 2026 come from the seeded v1 history (daily median sale price), later days are the tracker's own lowest-sell snapshots.
- **Near lows** lists items at or near (within 5%) their lowest price in the chart window and at least 10% under their 30-day average, biggest discount first.
- **Rising** lists items at least 10% over their 30-day average whose 7-day average is also at least 5% over it, so a single spike doesn't count. Biggest rise first.
- **Vaulted / Farmable** comes from the community [WFCD warframe-items](https://github.com/WFCD/warframe-items) dataset (warframe.market doesn't publish it), refreshed with the item list about weekly. Parts take their set's status. Brand-new primes can show "unknown" until WFCD adds them.
- **My items** has two tabs, saved in your browser (localStorage), not in this repo. **Owned** totals your items at the lowest sell, at the top buy order and in ducats, and charts the total over 90 days. **Tracking** lists starred items; give one a target price and it is marked "Target hit" (and sorted to the top) once the lowest sell is at or under it. The page only checks while it is open. Export / Import moves both lists between browsers.
- **Layout**: Rows (a dense screener table, the default) or Cards (bigger charts with a hover readout).
- Both lists skip items under 10p (a 1-2p move looks like a huge percentage) and items with under 30 days of history (new releases keep falling for weeks). The thresholds are at the top of `collector/summary.py`. These are price signals, not trading advice.
- **What's tracked:** every item tagged prime on warframe.market that is a Warframe or a primary, secondary or melee weapon, both the full set and each part. Sentinels, archwing, Kavasa collar and mods are left out. Weapon parts aren't tagged primary/secondary/melee, so they take the category of the set whose name they start with (Nikana Prime Blade → Melee).
- Only these summary numbers are stored. No individual orders or usernames are kept.

## Setup

1. **Create a public repo** on GitHub (for example `prime-set-tracker`) and upload these files. Public keeps Actions and Pages free.
2. **Allow the job to commit.** Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save.
3. **Turn on the site.** Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)` → Save. The address appears on that page after a minute.
4. **Run it once by hand.** Actions → **Collect prices** → **Run workflow**. When it finishes green, `data/latest.json` exists and the page shows prices.
5. **Optional: start the charts with old data.** Actions → **Seed history (run once)** → **Run workflow**. This copies the last 90 days of the old v1 sale history (May to August 2026). The page picks it up after the next hourly run.

From then on the job runs every hour by itself.

**If the first run fails with HTTP 403:** warframe.market (behind Cloudflare) may be blocking GitHub's servers. The job log says which request failed. In that case the collector needs to run from somewhere else; the code doesn't change.

## Price alerts (optional)

Alerts post to a Discord channel when an item's lowest sell crosses a price you choose. You get one message when it crosses, not one every hour.

1. In Discord: channel settings → Integrations → Webhooks → New Webhook → **Copy Webhook URL**.
2. In GitHub: Settings → Secrets and variables → Actions → **New repository secret**, name `DISCORD_WEBHOOK_URL`, paste the URL.
3. Edit `config/alerts.json`:

```json
{
 "alerts": [
  {"slug": "nova_prime_set", "when": "below", "price": 65},
  {"slug": "loki_prime_set", "when": "above", "price": 130}
 ]
}
```

`slug` is the end of the item's warframe.market link (`warframe.market/items/nova_prime_set`). `when` is `below` (at or below) or `above` (at or above). Without the secret, alerts only show in the job log.

## Repo size

Each hourly run adds about 40 KB of history (one row per item), so the history grows by roughly 30 MB a month. That's fine for a long while; GitHub's soft limit is around 1 GB. If it ever gets big, old monthly files in `data/history/` can be deleted (the page only reads the last 95 days).

## Other platforms

Prices default to PC. For another platform, add a repository **variable** (Settings → Secrets and variables → Actions → Variables) named `WFM_PLATFORM` with `xbox`, `ps4` or `switch`. Start with a fresh `data/history` folder when switching, so platforms don't mix.

## API etiquette

The collector follows the [API rules](https://docs.warframe.market/docs/rules/overview):

- about 2.5 requests per second, under the 3 per second limit, for about 5 minutes an hour;
- a User-Agent naming this project and linking this repo, never pretending to be a browser;
- the item catalogue is only downloaded again when `/v2/versions` reports a change, or weekly;
- if more than half the items fail, the run saves nothing and shows as failed in Actions.

## Files

| Path | What it is |
|---|---|
| `collector/collect.py` | The hourly job: refresh item list, snapshot prices, rebuild summary, check alerts |
| `collector/wfm.py` | API client: spacing between calls, retries, User-Agent |
| `collector/summary.py` | Builds `data/latest.json` from the history files |
| `collector/alerts.py` | Discord alerts |
| `collector/vault.py` | Vaulted status from WFCD warframe-items |
| `collector/seed_v1.py` | One-off import of the old v1 history |
| `config/alerts.json` | Your alert rules |
| `data/` | Written by the job; don't edit by hand |
| `index.html`, `assets/` | The page |
| `tests/simulate.py` | Offline test: two weeks of fake hourly runs |

## Running locally

Needs Python 3.10+ and nothing else.

```
python collector/collect.py      # one real snapshot into data/
python tests/simulate.py         # offline test, touches nothing in data/
python -m http.server            # then open http://localhost:8000
```

Warframe Price Tracker is a fan project. It is not affiliated with, endorsed by, or sponsored by Digital Extremes Ltd. or warframe.market. Warframe and all related names and logos are trademarks of Digital Extremes Ltd.
