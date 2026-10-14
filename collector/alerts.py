"""Price alerts: post to Discord when a set crosses a threshold you set.

Alerts live in config/alerts.json. A message is sent only when an alert
starts being true (not every hour while it stays true). Without the
DISCORD_WEBHOOK_URL secret, alerts are just printed in the job log.
"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path


def _send_discord(url: str, text: str, user_agent: str) -> None:
    body = json.dumps({"content": text}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "User-Agent": user_agent,
    })
    try:
        urllib.request.urlopen(req, timeout=15).close()
    except urllib.error.URLError as err:
        print(f"  ! Discord message failed: {err}")


def check(latest: dict, config_file: Path, state_file: Path, user_agent: str) -> None:
    if not config_file.exists():
        return
    rules = json.loads(config_file.read_text(encoding="utf-8")).get("alerts", [])
    state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
    by_slug = {s["slug"]: s for s in latest["sets"]}
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    new_state = {}

    for rule in rules:
        slug, when, price = rule.get("slug"), rule.get("when"), rule.get("price")
        item = by_slug.get(slug)
        if not item or when not in ("below", "above") or not isinstance(price, (int, float)):
            print(f"  ! skipping alert {rule}: unknown set or bad rule")
            continue
        sell = item.get("sell")
        key = f"{slug}:{when}:{price}"
        hit = sell is not None and (sell <= price if when == "below" else sell >= price)
        new_state[key] = hit
        if hit and not state.get(key):
            word = "at or below" if when == "below" else "at or above"
            text = (f"**{item['name']}** is {sell:g}p, {word} your {price:g}p alert. "
                    f"https://warframe.market/items/{slug}")
            print(f"  alert: {text}")
            if webhook:
                _send_discord(webhook, text, user_agent)

    state_file.write_text(json.dumps(new_state, indent=1) + "\n", encoding="utf-8")
