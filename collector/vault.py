"""Vaulted status of prime items, from the community WFCD warframe-items dataset.

warframe.market doesn't say whether an item is vaulted (its relics no longer
drop, so it can only be bought from other players). The WFCD project
(https://github.com/WFCD/warframe-items) tracks it per Warframe and weapon.
Parts take the status of the set whose name they start with:
"Ash Prime Neuroptics Blueprint" -> "Ash Prime".

Only fetched when the item list is refreshed (about weekly). If it fails, the
caller keeps the last known status; prices don't depend on it.

Set WFM_FIXTURES to read wfcd_<Category>.json from that folder instead (tests).
"""
import json
import os
import urllib.request
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/{}.json"
CATEGORIES = ("Warframes", "Primary", "Secondary", "Melee")


def _load(category: str, user_agent: str):
    if os.environ.get("WFM_FIXTURES"):
        file = Path(os.environ["WFM_FIXTURES"]) / f"wfcd_{category}.json"
        return json.loads(file.read_text(encoding="utf-8")) if file.exists() else []
    req = urllib.request.Request(SOURCE.format(category), headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch(user_agent: str) -> dict:
    """{"Ash Prime": True, "Lex Prime": False, ...} for every prime Warframe and weapon."""
    status = {}
    for category in CATEGORIES:
        for item in _load(category, user_agent):
            name = item.get("name", "")
            if name.endswith(" Prime") and isinstance(item.get("vaulted"), bool):
                status[name] = item["vaulted"]
    return status


def annotate(items: list, status: dict) -> int:
    """Set item["vaulted"] to True, False or None (unknown). Returns how many are known."""
    known = 0
    for item in items:
        base = max((b for b in status if item["name"].startswith(b + " ")), key=len, default=None)
        item["vaulted"] = status.get(base)
        known += item["vaulted"] is not None
    return known
