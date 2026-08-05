"""Downloads the FFmpeg.wasm runtime into vendor/ so the browser POC works
same-origin (module worker + relative imports resolve on localhost).

IMPORTANT: @ffmpeg/ffmpeg 0.12 creates its worker with `type:"module"`, so
`importScripts()` is unavailable and the worker falls back to `import()`.
That requires the **ESM** build of the core (with a `default` export), NOT the
umd build. Hence @ffmpeg/core's `dist/esm/` files are used here.

  vendor/ffmpeg-core.js / .wasm      -> @ffmpeg/core@0.12.6 esm
  vendor/ffmpeg-mod/*.js             -> @ffmpeg/ffmpeg@0.12.15 esm
  vendor/util/*.js                   -> @ffmpeg/util@0.12.2 esm
"""
from pathlib import Path
from urllib.request import urlretrieve

HERE = Path(__file__).resolve().parent
UNPKG = "https://unpkg.com"


def grab(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(url, dest)
    print(f"ok  {dest.relative_to(HERE)} ({dest.stat().st_size} bytes)")
    return dest


# 1) core — ESM build (module worker imports it via `import()`)
grab(f"{UNPKG}/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js", HERE / "ffmpeg-core.js")
grab(f"{UNPKG}/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm", HERE / "ffmpeg-core.wasm")

# 2) @ffmpeg/ffmpeg esm module set (worker.js imports ./const.js ./errors.js)
FFMPEG_FILES = [
    "index.js", "classes.js", "const.js", "errors.js",
    "utils.js", "types.js", "worker.js",
]
for name in FFMPEG_FILES:
    grab(f"{UNPKG}/@ffmpeg/ffmpeg@0.12.15/dist/esm/{name}", HERE / "ffmpeg-mod" / name)

# 3) @ffmpeg/util esm (index.js + deps const.js/errors.js)
UTIL_FILES = ["index.js", "const.js", "errors.js"]
for name in UTIL_FILES:
    grab(f"{UNPKG}/@ffmpeg/util@0.12.2/dist/esm/{name}", HERE / "util" / name)

print("done.")