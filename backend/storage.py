"""SQLite is the source of truth for completed sessions and Guardian actions."""
import json
import sqlite3
from pathlib import Path


class Store:
    def __init__(self, path):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, account TEXT NOT NULL, digest TEXT NOT NULL,
                event TEXT NOT NULL, decision TEXT NOT NULL, dossier TEXT NOT NULL,
                amount REAL NOT NULL, inference REAL, ring TEXT,
                acknowledged INTEGER NOT NULL DEFAULT 0, frozen INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions(account);
            CREATE TABLE IF NOT EXISTS bans (
                operator TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
                PRIMARY KEY (operator, mode)
            );
        """)

    def session(self, session_id):
        return self.db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()

    def save(self, digest, event, decision, dossier, amount, inference, ring):
        with self.db:
            self.db.execute("""INSERT INTO sessions
                (id,account,digest,event,decision,dossier,amount,inference,ring)
                VALUES (?,?,?,?,?,?,?,?,?)""", (
                event["session_id"], event["account_id"], digest, json.dumps(event),
                json.dumps(decision), json.dumps(dossier), amount, inference, ring))

    def snapshot(self):
        rows = self.db.execute("SELECT event FROM sessions ORDER BY rowid DESC LIMIT 200")
        events = [json.loads(r["event"]) for r in rows]
        kpis = self.db.execute("""
            SELECT COUNT(*) sessions, COALESCE(SUM(CASE WHEN json_extract(decision,'$.ui_mode')='MIRAGE_HOLD'
              THEN amount ELSE 0 END),0) held_amount_kzt, COUNT(DISTINCT ring) ring_count,
              AVG(inference) average_inference_ms FROM sessions
        """).fetchone()
        return events, dict(kpis)

    def set_ban(self, operator, mode, status):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO bans VALUES (?,?,?)", (operator, mode, status))

    def ban_status(self, operator, mode):
        row = self.db.execute("SELECT status FROM bans WHERE operator=? AND mode=?", (operator, mode)).fetchone()
        return row["status"] if row else None

    def guardian_holds(self, account):
        rows = self.db.execute("""SELECT id, account, amount, event, decision, frozen FROM sessions
            WHERE account=? AND json_extract(decision,'$.ui_mode')='MIRAGE_HOLD'
            ORDER BY rowid DESC LIMIT 200""", (account,))
        return [dict(session_id=r["id"], account_id=r["account"], amount_kzt=r["amount"],
                     reference_code=json.loads(r["decision"])["reference_code"],
                     status="frozen" if r["frozen"] else "held",
                     timestamp=json.loads(r["event"])["timestamp"]) for r in rows]

    def guardian_action(self, account, session, freeze):
        with self.db:
            cursor = self.db.execute("""UPDATE sessions SET acknowledged=1, frozen=MAX(frozen,?)
                WHERE id=? AND account=? AND json_extract(decision,'$.ui_mode')='MIRAGE_HOLD'""",
                                     (int(freeze), session, account))
        return cursor.rowcount == 1
