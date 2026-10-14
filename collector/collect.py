#!/usr/bin/env python3
"""Hourly snapshot of prime Warframe set prices from warframe.market.

One run:
1. refreshes the list of prime Warframe sets when the catalogue changed (or weekly),
2. reads the top orders for each set and appends one row per set to
   data/history/YYYY-MM.csv (lowest sell, highest buy),
3. rebuilds data/latest.json, which the web page reads,
4. checks price alerts.

Only summary numbers are stored, never individual orders or usernames.
"""
import csv
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import alerts  # noqa: E402
import summary  # noqa: E402
import wfm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("WFM_DATA_DIR") or ROOT / "data")  # override used by tests
HISTORY = DATA / "history"
SETS_FILE = DATA / "sets.json"
PLATFORM = os.environ.get("WFM_PLATFORM", "pc")
FIELDS = ["ts", "slug", "sell", "buy", "source"]
CATALOGUE_MAX_AGE = timedelta(days=7)
MAX_FAILED_SHARE = 0.5  # more failures than this means something is wrong: write nothing


def now() -> datetime:
    override = os.environ.get("WFM_NOW")  # used by tests
    if override:
        return datetime.fromisoformat(override.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def is_prime_warframe_set(item: dict) -> bool:
    tags = set(item.get("tags", []))
    return {"set", "prime", "warframe"} <= tags


def refresh_sets(at: datetime) -> list:
    """Return the prime Warframe sets, re-downloading the catalogue only when needed."""
    cached = load_json(SETS_FILE, None)
    versions = wfm.get("/v2/versions", PLATFORM).get("data")
    fingerprint = json.dumps(versions, sort_keys=True)

    if cached:
        fetched = datetime.fromisoformat(cached["fetched"].replace("Z", "+00:00"))
        if cached.get("versions") == fingerprint and at - fetched < CATALOGUE_MAX_AGE:
            return cached["sets"]

    items = wfm.get("/v2/items", PLATFORM).get("data") or []
    sets = []
    for item in items:
        if not is_prime_warframe_set(item):
            continue
        name = (item.get("i18n", {}).get("en") or {}).get("name") or item["slug"]
        sets.append({"slug": item["slug"], "name": name, "ducats": item.get("ducats")})
    sets.sort(key=lambda s: s["name"])
    if not sets:
        raise wfm.ApiError("item catalogue had no prime Warframe sets; the API may have changed")

    save_json(SETS_FILE, {
        "fetched": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "versions": fingerprint,
        "sets": sets,
    })
    print(f"catalogue refreshed: {len(sets)} prime Warframe sets")
    return sets


def snapshot(slug: str):
    """Lowest sell and highest buy price from the item's top orders."""
    data = wfm.get(f"/v2/orders/item/{slug}/top", PLATFORM).get("data") or {}
    sells = [o["platinum"] for o in data.get("sell", []) if isinstance(o.get("platinum"), (int, float))]
    buys = [o["platinum"] for o in data.get("buy", []) if isinstance(o.get("platinum"), (int, float))]
    return (min(sells) if sells else None, max(buys) if buys else None)


def append_rows(at: datetime, rows: list) -> int:
    HISTORY.mkdir(parents=True, exist_ok=True)
    file = HISTORY / f"{at:%Y-%m}.csv"
    seen = set()
    if file.exists():
        with file.open(newline="", encoding="utf-8") as f:
            seen = {(r["ts"], r["slug"]) for r in csv.DictReader(f)}
    new = [r for r in rows if (r["ts"], r["slug"]) not in seen]
    if not new:
        return 0
    write_header = not file.exists()
    with file.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerows(new)
    return len(new)


def main() -> int:
    at = now()
    hour = at.replace(minute=0, second=0, microsecond=0)
    ts = hour.strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"prime-set-tracker {wfm.VERSION} · {ts} · platform {PLATFORM}")

    sets = refresh_sets(at)
    rows, failed = [], []
    for s in sets:
        try:
            sell, buy = snapshot(s["slug"])
        except wfm.ApiError as err:
            failed.append(s["slug"])
            print(f"  ! {err}")
            continue
        rows.append({"ts": ts, "slug": s["slug"], "sell": "" if sell is None else sell,
                     "buy": "" if buy is None else buy, "source": "live"})

    if len(failed) > len(sets) * MAX_FAILED_SHARE:
        print(f"{len(failed)} of {len(sets)} sets failed; not saving this run")
        return 1

    added = append_rows(hour, rows)
    print(f"saved {added} rows ({len(failed)} sets failed)")

    latest = summary.build(HISTORY, sets, at, PLATFORM, wfm.VERSION)
    save_json(DATA / "latest.json", latest)
    alerts.check(latest, ROOT / "config" / "alerts.json", DATA / "alerts_state.json", wfm.user_agent())
    return 0


if __name__ == "__main__":
    sys.exit(main())
