"""Cooperative access to identity state within the single backend worker."""

import asyncio
from contextlib import asynccontextmanager


class IdentityAccess:
    """Allow concurrent scoring while ordering ban and enrollment writes."""

    def __init__(self):
        self.entry = asyncio.Lock()
        self.readers = 0
        self.idle = asyncio.Event()
        self.idle.set()

    @asynccontextmanager
    async def score(self):
        async with self.entry:
            self.readers += 1
            self.idle.clear()
        try:
            yield
        finally:
            # All accesses occur on the same event loop, including cancellation.
            self.readers -= 1
            if not self.readers:
                self.idle.set()

    @asynccontextmanager
    async def change(self):
        async with self.entry:
            # While a writer waits, new scoring requests queue at the entry.
            await self.idle.wait()
            yield
