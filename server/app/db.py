import os

import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgres://whiteboard:whiteboard@localhost:5432/whiteboard",
)

pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=20)
    return pool


async def close_pool() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None
