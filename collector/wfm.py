"""Small, polite client for the warframe.market API (standard library only).

Follows the API rules at https://docs.warframe.market/docs/rules/overview:
- stays well under 3 requests per second,
- sends an honest User-Agent naming this project and its repo,
- caches the item catalogue instead of re-downloading it every run.

Set WFM_FIXTURES to a folder of saved JSON responses to run without network
(used by the offline tests).
"""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

VERSION = "0.5.0-beta"
API = "https://api.warframe.market"
REQUEST_GAP = 0.4  # seconds between requests: about 2.5 per second
RETRIES = 3

_last_request = 0.0


def user_agent() -> str:
    repo = os.environ.get("GITHUB_REPOSITORY")
    contact = f"+https://github.com/{repo}" if repo else "local run"
    return f"warframe-price-tracker/{VERSION} ({contact})"


def _fixture(path: str):
    folder = Path(os.environ["WFM_FIXTURES"])
    name = path.strip("/").replace("/", "_") + ".json"
    file = folder / name
    if not file.exists():
        raise ApiError(f"no fixture for {path} ({name})")
    return json.loads(file.read_text(encoding="utf-8"))


class ApiError(RuntimeError):
    pass


def get(path: str, platform: str = "pc"):
    """GET a JSON endpoint, with spacing between calls and a few retries."""
    if os.environ.get("WFM_FIXTURES"):
        return _fixture(path)

    global _last_request
    url = API + path
    headers = {
        "User-Agent": user_agent(),
        "Accept": "application/json",
        "Language": "en",
        "Platform": platform,
    }
    for attempt in range(1, RETRIES + 1):
        wait = REQUEST_GAP - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise ApiError(f"{path}: not found") from err
            retryable = err.code == 429 or err.code >= 500
            if not retryable or attempt == RETRIES:
                raise ApiError(f"{path}: HTTP {err.code}") from err
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            if attempt == RETRIES:
                raise ApiError(f"{path}: {err}") from err
        time.sleep(2 * attempt)  # back off before retrying
    raise ApiError(f"{path}: gave up")
