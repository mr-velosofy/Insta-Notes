from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"

app = FastAPI(title="Insta Notes Studio")

app.mount("/styles", StaticFiles(directory=BASE_DIR / "styles"), name="styles")
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")
app.mount("/vendor", StaticFiles(directory=BASE_DIR / "vendor"), name="vendor")


@app.get("/ping", include_in_schema=False)
def ping() -> Response:
    return Response("pong", media_type="text/plain")


@app.get("/", include_in_schema=False)
def index() -> Response:
    return FileResponse(TEMPLATES_DIR / "landing.html")


@app.get("/studio", include_in_schema=False)
def studio() -> Response:
    return FileResponse(TEMPLATES_DIR / "studio.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
