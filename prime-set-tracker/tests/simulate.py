#!/usr/bin/env python3
"""Offline test: simulate two weeks of hourly runs against fake API responses.

The responses copy the real API's shape (captured October 2026), with prices
that drift so the charts and averages have something to show. Nothing here
touches the network or the repo's real data folder.

    python tests/simulate.py            # run and check
    python tests/simulate.py --keep DIR # also leave the output in DIR
"""
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETS = {  # slug: (name, ducats, starting price) - item fields mirror /v2/items
    "nova_prime_set": ("Nova Prime Set", None, 74),
    "mag_prime_set": ("Mag Prime Set", None, 74),
    "frost_prime_set": ("Frost Prime Set", 175, 47),
    "hydroid_prime_set": ("Hydroid Prime Set", 205, 54),
}
OTHER_ITEMS = [  # real catalogue entries that must NOT be picked up
    {"id": "56783f24cbfa8f0432dd89b0", "slug": "vasto_prime_set", "tags": ["weapon", "prime", "set", "secondary"],
     "i18n": {"en": {"name": "Vasto Prime Set"}}},
    {"id": "5ab1570db2b6a8044d5137c3", "slug": "zephyr_prime_chassis_blueprint",
     "tags": ["component", "prime", "warframe", "blueprint"], "i18n": {"en": {"name": "Zephyr Prime Chassis Blueprint"}}},
    {"id": "57222f1c92cc365777a61c0f", "slug": "mantis_set", "tags": ["set"], "i18n": {"en": {"name": "Mantis Set"}}},
]


def order(kind, plat, qty=1):
    return {"id": "x", "type": kind, "platinum": plat, "quantity": qty, "perTrade": 1, "visible": True,
            "createdAt": "2026-10-07T02:23:06Z", "updatedAt": "2026-10-08T00:11:50Z", "itemId": "x",
            "user": {"id": "x", "ingameName": "test", "slug": "test", "reputation": 0, "platform": "pc",
                     "crossplay": True, "locale": "en", "status": "ingame"}}


def write_fixtures(folder: Path, prices: dict, catalogue_version: str):
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("v2_orders_item_*_top.json"):
        old.unlink()
    items =[{"id": f"id-{slug}", "slug": slug, "tags": ["set", "prime", "warframe"], "ducats": d,
              "i18n": {"en": {"name": name}}} for slug, (name, d, _) in SETS.items()] + OTHER_ITEMS
    (folder / "v2_items.json").write_text(json.dumps({"apiVersion": "0.25.0", "data": items, "error": None}))
    (folder / "v2_versions.json").write_text(json.dumps({"apiVersion": "0.25.0",
                                                         "data": {"collections": {"items": catalogue_version}}}))
    for slug, p in prices.items():
        if slug == "hydroid_prime_set" and p is None:  # simulate an outage for one set
            continue
        sell = [order("sell", p), order("sell", p), order("sell", p + 3), order("sell", p + 4, 8)]
        buy = [order("buy", p - 5), order("buy", p - 8), order("buy", p - 9, 99)]
        body = {"apiVersion": "0.25.0", "data": {"sell": sell, "buy": buy}, "error": None}
        (folder / f"v2_orders_item_{slug}_top.json").write_text(json.dumps(body))


def main():
    keep = sys.argv[sys.argv.index("--keep") + 1] if "--keep" in sys.argv else None
    work = Path(tempfile.mkdtemp(prefix="pst-"))
    data, fixtures = work / "data", work / "fixtures"
    rng = random.Random(7)
    price = {slug: start for slug, (_, _, start) in SETS.items()}
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    env = {**os.environ, "WFM_FIXTURES": str(fixtures), "WFM_DATA_DIR": str(data)}
    env.pop("DISCORD_WEBHOOK_URL", None)

    runs = 0
    for hour in range(0, 14 * 24, 3):  # every 3 hours for 14 days
        at = start + timedelta(hours=hour)
        for slug in price:
            drift = -0.06 if slug == "nova_prime_set" else 0.05
            price[slug] = max(10, round(price[slug] + drift + rng.uniform(-1, 1)))
        snap = dict(price)
        if 100 <= hour < 106:
            snap["hydroid_prime_set"] = None
        write_fixtures(fixtures, snap, "v1" if hour < 200 else "v2")
        res = subprocess.run([sys.executable, str(ROOT / "collector" / "collect.py")],
                             env={**env, "WFM_NOW": at.strftime("%Y-%m-%dT%H:%M:%SZ")},
                             capture_output=True, text=True)
        if res.returncode != 0:
            print(res.stdout, res.stderr)
            raise SystemExit("collector failed")
        runs += 1

    # A rerun in the same hour must not duplicate rows.
    subprocess.run([sys.executable, str(ROOT / "collector" / "collect.py")],
                   env={**env, "WFM_NOW": at.strftime("%Y-%m-%dT%H:%M:%SZ")}, check=True, capture_output=True)

    latest = json.loads((data / "latest.json").read_text())
    slugs = [s["slug"] for s in latest["sets"]]
    assert sorted(slugs) == sorted(SETS), f"wrong sets picked: {slugs}"
    nova = next(s for s in latest["sets"] if s["slug"] == "nova_prime_set")
    assert nova["sell"] == price["nova_prime_set"], nova
    assert nova["buy"] == price["nova_prime_set"] - 5, nova
    assert nova["avg30"] is not None and nova["change_pct"] is not None, nova
    assert len(nova["spark"]) == 30 and sum(v is not None for v in nova["spark"]) == 14, nova["spark"]
    rows = (data / "history" / "2026-10.csv").read_text().strip().splitlines()
    assert len(rows) - 1 == runs * 4 - 2, f"expected {runs * 4 - 2} rows, got {len(rows) - 1}"
    print(f"ok: {runs} simulated runs, {len(rows) - 1} history rows, "
          f"Nova {nova['sell']:g}p vs 30d avg {nova['avg30']}p ({nova['change_pct']:+}%)")

    if keep:
        shutil.copytree(data, Path(keep) / "data", dirs_exist_ok=True)
    shutil.rmtree(work)


if __name__ == "__main__":
    main()
