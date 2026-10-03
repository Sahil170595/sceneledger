from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth import auth_router
from app.canvas import canvas_router
from app.db import close_pool, get_pool
from app.ws import websocket_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await get_pool()
    yield
    await close_pool()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Return errors in the contract envelope: {"error": "<code>"}."""
    detail = exc.detail if isinstance(exc.detail, str) else "error"
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


app.include_router(auth_router, prefix="/api/auth")
app.include_router(canvas_router, prefix="/api/canvases")
app.add_api_websocket_route("/ws", websocket_endpoint)


@app.get("/health")
async def health() -> dict:
    pool = await get_pool()
    async with pool.acquire(timeout=5) as conn:
        await conn.fetchval("SELECT 1")
    return {"ok": True}
