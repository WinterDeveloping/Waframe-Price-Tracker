"""Build data/latest.json, the small summary the web page reads."""
import csv
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

WINDOW_DAYS = 95      # how much history to read
SPARK_DAYS = 90       # points in each card's chart (and the low/high window)
MIN_DAYS_FOR_AVG = 3  # don't show an average built from less than this

# "What to buy" / "What to sell" picks. Cheap items swing by large percentages on
# a 1-2p move, and short histories make the "usual" price meaningless, so both
# are excluded.
PICK_MIN_PRICE = 10    # plat
PICK_MIN_DAYS = 30     # days of history before today; new releases fall for weeks after launch
PICK_MIN_MOVE = 10     # % away from the 30-day average
BUY_NEAR_LOW = 1.05    # at most 5% above the lowest day in the chart window
SELL_WEEK_UP = 1.05    # 7-day average at least 5% over the 30-day one
PICKS = 40             # items per list


def _num(value):
    try:
        return float(value) if value not in ("", None) else None
    except ValueError:
        return None


def _read_rows(history: Path, since: date):
    for file in sorted(history.glob("*.csv")):
        with file.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                ts = datetime.fromisoformat(row["ts"].replace("Z", "+00:00"))
                if ts.date() >= since:
                    yield ts, row


def _avg(daily: dict, today: date, days: int):
    values = [v for d, v in daily.items() if today - timedelta(days=days - 1) <= d <= today]
    if len(values) < MIN_DAYS_FOR_AVG:
        return None
    return round(statistics.mean(values), 1)


def build(history: Path, sets: list, at: datetime, platform: str, version: str) -> dict:
    today = at.date()
    since = today - timedelta(days=WINDOW_DAYS)

    sells = defaultdict(lambda: defaultdict(list))  # slug -> day -> [sell prices]
    latest = {}                                     # slug -> newest live row
    first_live = {}
    newest_ts = None

    for ts, row in _read_rows(history, since):
        slug = row["slug"]
        sell = _num(row.get("sell"))
        if sell is not None:
            sells[slug][ts.date()].append(sell)
        if row.get("source") == "live":
            if slug not in latest or ts > latest[slug][0]:
                latest[slug] = (ts, row)
            if slug not in first_live or ts < first_live[slug]:
                first_live[slug] = ts
            if newest_ts is None or ts > newest_ts:
                newest_ts = ts

    out = []
    for s in sets:
        slug = s["slug"]
        daily = {d: statistics.median(v) for d, v in sells[slug].items()}
        ts_row = latest.get(slug)
        sell = _num(ts_row[1].get("sell")) if ts_row else None
        buy = _num(ts_row[1].get("buy")) if ts_row else None
        avg7 = _avg(daily, today, 7)
        avg30 = _avg(daily, today, 30)
        change = round((sell - avg30) / avg30 * 100, 1) if sell is not None and avg30 else None
        spark_days = [today - timedelta(days=i) for i in range(SPARK_DAYS - 1, -1, -1)]
        before = {d: v for d, v in daily.items() if spark_days[0] <= d < today}
        low_day = min(before, key=before.get) if before else None
        high_day = max(before, key=before.get) if before else None
        out.append({
            "slug": slug,
            "name": s["name"],
            "ducats": s.get("ducats"),
            "group": s.get("group", "warframe"),
            "kind": s.get("kind", "set"),
            "vaulted": s.get("vaulted"),
            "sell": sell,
            "buy": buy,
            "avg7": avg7,
            "avg30": avg30,
            "change_pct": change,
            "spark": [daily.get(d) for d in spark_days],
            "history_days": len(before),
            "low": before[low_day] if low_day else None,
            "low_date": low_day.isoformat() if low_day else None,
            "high": before[high_day] if high_day else None,
            "high_date": high_day.isoformat() if high_day else None,
            "tracked_since": first_live[slug].strftime("%Y-%m-%d") if slug in first_live else None,
        })

    return {
        "version": version,
        "platform": platform,
        "generated": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "snapshot": newest_ts.strftime("%Y-%m-%dT%H:%M:%SZ") if newest_ts else None,
        "spark_start": (today - timedelta(days=SPARK_DAYS - 1)).isoformat(),
        "buy": buy_picks(out),
        "sell": sell_picks(out),
        "sets": out,
    }


def _pickable(s: dict) -> bool:
    return (s["sell"] is not None and s["sell"] >= PICK_MIN_PRICE and s["change_pct"] is not None
            and s["history_days"] >= PICK_MIN_DAYS)


def buy_picks(items: list) -> list:
    """At or near the lowest price in the chart window, and well under the 30-day average."""
    hits = [s for s in items if _pickable(s) and s["low"] is not None
            and s["sell"] <= s["low"] * BUY_NEAR_LOW and s["change_pct"] <= -PICK_MIN_MOVE]
    hits.sort(key=lambda s: s["change_pct"])
    return [s["slug"] for s in hits[:PICKS]]


def sell_picks(items: list) -> list:
    """Well above the 30-day average, with the last week also clearly above it (an uptrend, not one spike)."""
    hits = [s for s in items if _pickable(s) and s["change_pct"] >= PICK_MIN_MOVE
            and s["avg7"] is not None and s["avg7"] >= s["avg30"] * SELL_WEEK_UP]
    hits.sort(key=lambda s: -s["change_pct"])
    return [s["slug"] for s in hits[:PICKS]]
