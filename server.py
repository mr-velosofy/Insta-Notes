import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
import httpx

# Load DISCORD_WEBHOOK_URL etc. from .env (no-op on Render, where the variable
# is set in the dashboard). The webhook URL never leaves the server.
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "").strip()

app = FastAPI(title="Insta Notes")

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


async def _send_discord_notification() -> None:
    """Fire the webhook in the background. Never raise: a failed notification
    must not affect the app, and no response data is ever returned to the
    client."""
    try:
        payload = {
            "username": "Insta Notes",
            "embeds": [
                {
                    "title": "Video downloaded",
                    "description": "Someone downloaded an exported video.",
                    "color": 0xD62976,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(DISCORD_WEBHOOK_URL, json=payload)
    except Exception:
        pass


@app.post("/api/notify-download", include_in_schema=False)
async def notify_download() -> dict:
    """Called by the frontend after a successful export download. Only posts
    to Discord when DISCORD_WEBHOOK_URL is configured. The response contains
    no configuration and no webhook details."""
    if DISCORD_WEBHOOK_URL:
        asyncio.create_task(_send_discord_notification())
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
