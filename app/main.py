from __future__ import annotations

import base64
import binascii
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .icc import IccError, export_profile, inspect_profile, MAX_BYTES

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="ICC Table", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


async def read_profile(request: Request) -> bytes:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 64 MB.")

    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds 64 MB.")
    return bytes(data)


@app.post("/api/inspect")
async def inspect(request: Request) -> dict:
    try:
        return inspect_profile(await read_profile(request))
    except IccError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/export")
async def export(request: Request) -> Response:
    try:
        data = await read_profile(request)
        order_text = request.headers.get("x-tag-order", "")
        order = [int(value) for value in order_text.split(",") if value]
        encoded_header = request.headers.get("x-icc-header", "e30=")
        header = json.loads(base64.b64decode(encoded_header, validate=True))
        result = export_profile(data, order, header)
    except (IccError, ValueError, binascii.Error, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return Response(
        content=result,
        media_type="application/vnd.iccprofiles",
        headers={"Content-Disposition": 'attachment; filename="profile-edited.icc"'},
    )
