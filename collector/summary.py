"""Build data/latest.json, the small summary the web page reads."""
import csv
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

WINDOW_DAYS = 95      # how much history to read
SPARK_DAYS = 30       # points in each card's chart
MIN_DAYS_FOR_AVG = 3  # don't show an average built from less than this


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
        out.append({
            "slug": slug,
            "name": s["name"],
            "ducats": s.get("ducats"),
            "sell": sell,
            "buy": buy,
            "avg7": avg7,
            "avg30": avg30,
            "change_pct": change,
            "spark": [daily.get(d) for d in spark_days],
            "tracked_since": first_live[slug].strftime("%Y-%m-%d") if slug in first_live else None,
        })

    return {
        "version": version,
        "platform": platform,
        "generated": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "snapshot": newest_ts.strftime("%Y-%m-%dT%H:%M:%SZ") if newest_ts else None,
        "spark_start": (today - timedelta(days=SPARK_DAYS - 1)).isoformat(),
        "sets": out,
    }
