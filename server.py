import asyncio
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx

# Load DISCORD_WEBHOOK_URL etc. from .env (no-op on Render, where the variable
# is set in the dashboard). The webhook URL never leaves the server.
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
# Public site URL, used only for Discord embed links/images. Render sets
# RENDER_EXTERNAL_URL for web services; local runs fall back to the live URL.
SITE_URL = os.getenv("RENDER_EXTERNAL_URL", "https://insta-notes.onrender.com").rstrip("/")

# --- Single-use export IDs ---------------------------------------------------
# When a video finishes converting, the server mints an 11-character ID
# (YouTube-style Base64URL alphabet) and hands it to the browser. The download
# is named "<id>.mp4", and the Discord notification only fires when the ID is
# presented AND still in this runtime map — so a download must be tied to a
# real export, each export notifies at most once, and replays/forgeries are
# rejected. Unused IDs expire after EXPORT_TTL_SECONDS to keep memory bounded.
EXPORT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
EXPORT_ID_LEN = 11
EXPORT_TTL_SECONDS = 2 * 60 * 60  # 2 hours

_export_ids: dict[str, float] = {}  # id -> expiry (monotonic)

# Minimal per-IP rate limiting for the two public POST routes so they cannot
# be spammed into flooding the webhook or the ID map.
_RATE_WINDOW = 60.0
_rate_hits: dict[str, list[float]] = {}  # ip -> hit timestamps


def _new_export_id() -> str:
    return "".join(secrets.choice(EXPORT_ALPHABET) for _ in range(EXPORT_ID_LEN))


def _sweep_export_ids() -> None:
    now = time.monotonic()
    for key in [k for k, exp in _export_ids.items() if exp <= now]:
        _export_ids.pop(key, None)


def _rate_limited(ip: str, limit: int) -> bool:
    now = time.monotonic()
    hits = [t for t in _rate_hits.get(ip, []) if now - t < _RATE_WINDOW]
    _rate_hits[ip] = hits
    if len(hits) >= limit:
        return True
    hits.append(now)
    return False


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _sweep_loop() -> None:
    while True:
        await asyncio.sleep(300)
        _sweep_export_ids()
        now = time.monotonic()
        for ip in [k for k, hits in _rate_hits.items() if not hits or now - hits[-1] > _RATE_WINDOW]:
            _rate_hits.pop(ip, None)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    task = asyncio.create_task(_sweep_loop())
    yield
    task.cancel()

app = FastAPI(title="Insta Notes", lifespan=_lifespan)

# Served before the /assets mount so the webmanifest gets an explicit
# media type (Python's built-in mimetypes table lacks .webmanifest).
@app.get("/assets/site.webmanifest", include_in_schema=False)
def site_manifest() -> Response:
    return FileResponse(
        BASE_DIR / "assets" / "site.webmanifest",
        media_type="application/manifest+json",
    )

app.mount("/styles", StaticFiles(directory=BASE_DIR / "styles"), name="styles")
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")
app.mount("/vendor", StaticFiles(directory=BASE_DIR / "vendor"), name="vendor")


@app.get("/ping", include_in_schema=False)
def ping() -> Response:
    return Response("pong", media_type="text/plain")


async def _send_discord_notification(export_id: str) -> None:
    """Fire the webhook in the background. Never raise: a failed notification
    must not affect the app, and no response data is ever returned to the
    client."""
    try:
        payload = {
            "username": "Insta Notes",
            "embeds": [
                {
                    "color": 0xD62976,
                    "author": {
                        "name": "Insta Notes",
                        "url": f"{SITE_URL}/",
                        "icon_url": f"{SITE_URL}/assets/icons/favicon/favicon.png",
                    },
                    "title": "Video downloaded",
                    "description": "A voice-note video was exported and downloaded.",
                    "thumbnail": {"url": f"{SITE_URL}/assets/insta-default.jpg"},
                    "fields": [
                        {
                            "name": "Export ID",
                            "value": f"`{export_id}`",
                            "inline": True,
                        },
                        {
                            "name": "Filename",
                            "value": f"`{export_id}.mp4`",
                            "inline": True,
                        },
                        {
                            "name": "Studio",
                            "value": f"[Open Insta Notes]({SITE_URL}/studio)",
                            "inline": True,
                        },
                    ],
                    "footer": {
                        "text": "Insta Notes • Download notification",
                        "icon_url": f"{SITE_URL}/assets/icons/favicon/favicon.png",
                    },
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(DISCORD_WEBHOOK_URL, json=payload)
    except Exception:
        pass


class DownloadEvent(BaseModel):
    id: str


@app.post("/api/claim-export", include_in_schema=False)
async def claim_export(request: Request) -> Response:
    """Mint a single-use export ID for a freshly generated video. Rate-limited
    per IP; unused IDs expire after the TTL."""
    if _rate_limited(_client_ip(request), 10):
        return Response(status_code=429)
    _sweep_export_ids()
    export_id = _new_export_id()
    _export_ids[export_id] = time.monotonic() + EXPORT_TTL_SECONDS
    return {"id": export_id}


@app.post("/api/notify-download", include_in_schema=False)
async def notify_download(request: Request, event: DownloadEvent) -> Response:
    """Called by the frontend after a successful export download. Only fires
    the Discord webhook when the presented ID was issued by claim-export and
    has not been used yet; the ID is consumed on use. Replays and unknown
    IDs get a 404 without any notification. The response contains no
    configuration and no webhook details."""
    export_id = event.id.strip()
    if not export_id:
        return Response(status_code=400)
    if _rate_limited(_client_ip(request), 10):
        return Response(status_code=429)
    _sweep_export_ids()
    if _export_ids.pop(export_id, None) is None:
        return Response(status_code=404)
    if DISCORD_WEBHOOK_URL:
        asyncio.create_task(_send_discord_notification(export_id))
    return {"ok": True}


@app.get("/", include_in_schema=False)
def index() -> Response:
    return FileResponse(TEMPLATES_DIR / "landing.html")

@app.get("/home", include_in_schema=False)
def index_2() -> Response:
    return FileResponse(TEMPLATES_DIR / "landing.html")


@app.get("/studio", include_in_schema=False)
def studio() -> Response:
    return FileResponse(TEMPLATES_DIR / "studio.html")


@app.get("/privacy", include_in_schema=False)
def privacy() -> Response:
    return FileResponse(TEMPLATES_DIR / "privacy.html")


@app.get("/terms", include_in_schema=False)
def terms() -> Response:
    return FileResponse(TEMPLATES_DIR / "terms.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
