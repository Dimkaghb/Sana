"""Account-scoped, payload-free Web Push for opted-in Guardian devices."""

import asyncio
from base64 import urlsafe_b64encode
from contextlib import suppress
import time

import httpx
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid


def valid_endpoint(endpoint):
    if not isinstance(endpoint, str) or len(endpoint) > 2048:
        return False
    try:
        url = httpx.URL(endpoint)
    except httpx.InvalidURL:
        return False
    providers = {"fcm.googleapis.com", "updates.push.services.mozilla.com",
                 "web.push.apple.com", "push.apple.com"}
    return (url.scheme == "https" and url.host in providers and not url.userinfo
            and url.port is None and not url.fragment and url.path != "/")


class GuardianPush:
    def __init__(self, db, client, subject):
        self.db = db
        self.client = client
        self.subject = subject
        self.wake = asyncio.Event()
        self.key = None

    def signing_key(self):
        if self.key is None:
            row = self.db.execute("SELECT pem FROM guardian_push_key WHERE id=1").fetchone()
            if row:
                self.key = Vapid.from_pem(row[0])
            else:
                self.key = Vapid()
                self.key.generate_keys()
                with self.db:
                    self.db.execute("INSERT INTO guardian_push_key VALUES (1,?)", (self.key.private_pem(),))
        return self.key

    def public_key(self):
        key = self.signing_key().public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        return urlsafe_b64encode(key).rstrip(b"=").decode()

    def registered(self, account, endpoint):
        return self.db.execute("SELECT 1 FROM guardian_push_devices WHERE account=? AND endpoint=?",
                               (account, endpoint)).fetchone() is not None

    def enable(self, account, endpoint):
        if self.registered(account, endpoint):
            return True
        with self.db:
            cursor = self.db.execute("""INSERT OR IGNORE INTO guardian_push_devices(account,endpoint)
                SELECT ?,? WHERE (SELECT COUNT(*) FROM guardian_push_devices WHERE account=?) < 8""",
                (account, endpoint, account))
        return cursor.rowcount == 1

    def disable(self, account, endpoint):
        with self.db:
            self.db.execute("DELETE FROM guardian_push_devices WHERE account=? AND endpoint=?", (account, endpoint))

    async def deliver(self):
        now = int(time.time())
        rows = self.db.execute("""SELECT endpoint, pending, queued_at, attempts FROM guardian_push_devices
            WHERE pending IS NOT NULL AND next_attempt<=? ORDER BY next_attempt LIMIT 16""", (now,)).fetchall()
        for row in rows:
            endpoint, session, queued, attempts = row
            status = None
            if now - queued < 3600:
                origin = str(httpx.URL(endpoint).copy_with(path="/", query=None)).rstrip("/")
                headers = self.signing_key().sign({"aud": origin, "sub": self.subject})
                headers.update(TTL=str(max(1, 3600 - (now - queued))), Urgency="high")
                try:
                    response = await self.client.post(endpoint, headers=headers, content=b"", follow_redirects=False)
                    status = response.status_code
                except httpx.RequestError:
                    pass
            with self.db:
                if status in (404, 410):
                    self.db.execute("DELETE FROM guardian_push_devices WHERE endpoint=? AND pending=?", (endpoint, session))
                elif (status is not None and 200 <= status < 300) or now - queued >= 3600:
                    self.db.execute("UPDATE guardian_push_devices SET pending=NULL WHERE endpoint=? AND pending=?", (endpoint, session))
                else:
                    delay = min(300, 5 * 2 ** min(attempts, 6))
                    self.db.execute("""UPDATE guardian_push_devices SET next_attempt=?, attempts=attempts+1
                        WHERE endpoint=? AND pending=?""", (now + delay, endpoint, session))

    async def run(self):
        while True:
            self.wake.clear()
            await self.deliver()
            with suppress(TimeoutError):
                await asyncio.wait_for(self.wake.wait(), timeout=5)
