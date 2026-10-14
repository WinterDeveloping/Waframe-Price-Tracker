#!/usr/bin/env python3
"""One-off: copy the old 90-day sale history (v1 statistics) into data/history/seed-v1.csv.

The v1 API is deprecated and stopped updating in August 2026, but its last
90 days still give the charts a starting point. Rows are marked source=v1 and
hold the daily median *sale* price (not the lowest listing). Run it once,
from the "Seed history" workflow or locally. Safe to re-run: it rewrites the file.
"""
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import collect  # noqa: E402
import wfm  # noqa: E402


def main() -> int:
    sets = collect.load_json(collect.SETS_FILE, None)
    if not sets:
        print("run collect.py once first so data/sets.json exists")
        return 1
    rows = []
    for s in sets["sets"]:
        try:
            payload = wfm.get(f"/v1/items/{s['slug']}/statistics", collect.PLATFORM).get("payload", {})
        except wfm.ApiError as err:
            print(f"  ! {err}")
            continue
        for day in payload.get("statistics_closed", {}).get("90days", []):
            median = day.get("median")
            if median is None:
                continue
            ts = day["datetime"][:10] + "T00:00:00Z"
            rows.append({"ts": ts, "slug": s["slug"], "sell": median, "buy": "", "source": "v1"})

    collect.HISTORY.mkdir(parents=True, exist_ok=True)
    out = collect.HISTORY / "seed-v1.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=collect.FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {out.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
