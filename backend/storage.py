"""SQLite is the source of truth for completed sessions and Guardian actions."""

import json
import sqlite3

from .risk_fusion import eligible_for_enrollment
from pathlib import Path


class Store:
    def __init__(self, path):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS pending_sessions (id TEXT PRIMARY KEY, digest TEXT NOT NULL);
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

        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS dashboard_totals (
                id INTEGER PRIMARY KEY CHECK(id=1), sessions INTEGER NOT NULL,
                held_amount REAL NOT NULL, inference_sum REAL NOT NULL, inference_count INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS guardian_push_key (id INTEGER PRIMARY KEY CHECK(id=1), pem BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS guardian_push_devices (
                endpoint TEXT PRIMARY KEY, account TEXT NOT NULL, pending TEXT,
                queued_at INTEGER, next_attempt INTEGER, attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS observed_rings (operator TEXT PRIMARY KEY);
        """)
        # Existing decisions are append-only. Backfill once, then maintain totals
        # in the same transaction as each new session, including older writers.
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            if not self.db.execute(
                "SELECT 1 FROM dashboard_totals WHERE id=1"
            ).fetchone():
                self.db.execute("""INSERT INTO dashboard_totals
                    SELECT 1, COUNT(*), COALESCE(SUM(CASE WHEN json_extract(decision,'$.ui_mode') IN ('MIRAGE_HOLD','STEALTH_HOLD')
                    THEN amount ELSE 0 END),0), COALESCE(SUM(inference),0), COUNT(inference) FROM sessions""")
                self.db.execute(
                    "INSERT OR IGNORE INTO observed_rings SELECT DISTINCT ring FROM sessions WHERE ring IS NOT NULL"
                )
            self.db.execute("DROP TRIGGER IF EXISTS session_updates_dashboard")
            self.db.execute("""CREATE TRIGGER IF NOT EXISTS session_updates_dashboard_v2 AFTER INSERT ON sessions
                BEGIN
                    UPDATE dashboard_totals SET sessions=sessions+1,
                        held_amount=held_amount+CASE WHEN json_extract(NEW.decision,'$.ui_mode') IN ('MIRAGE_HOLD','STEALTH_HOLD')
                            THEN NEW.amount ELSE 0 END,
                        inference_sum=inference_sum+COALESCE(NEW.inference,0),
                        inference_count=inference_count+(NEW.inference IS NOT NULL) WHERE id=1;
                    INSERT OR IGNORE INTO observed_rings SELECT NEW.ring WHERE NEW.ring IS NOT NULL;
                END""")

    def session(self, session_id):
        return self.db.execute(
            "SELECT * FROM sessions WHERE id=?", (session_id,)
        ).fetchone()

    def reserve(self, session, digest):
        # Bind an ID before contacting ML. An interrupted request can resume only
        # with its original input even if ML already processed the first attempt.
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO pending_sessions VALUES (?,?)", (session, digest)
            )
            row = self.db.execute(
                "SELECT digest FROM pending_sessions WHERE id=?", (session,)
            ).fetchone()
            return row["digest"] == digest

    def save(self, digest, event, decision, dossier, amount, inference, ring):
        stealth = decision.get("ui_mode") == "STEALTH_HOLD"
        with self.db:
            self.db.execute(
                """INSERT INTO sessions
                (id,account,digest,event,decision,dossier,amount,inference,ring,frozen)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    event["session_id"],
                    event["account_id"],
                    digest,
                    json.dumps(event),
                    json.dumps(decision),
                    json.dumps(dossier),
                    amount,
                    inference,
                    ring,
                    int(stealth),
                ),
            )

            if stealth:
                self.db.execute("""UPDATE guardian_push_devices SET pending=?, queued_at=unixepoch(),
                    next_attempt=0, attempts=0 WHERE account=?""", (event["session_id"], event["account_id"]))

            self.db.execute(
                "DELETE FROM pending_sessions WHERE id=?", (event["session_id"],)
            )

    def cache_fingerprint(self, session, value):
        with self.db:
            self.db.execute(
                "UPDATE sessions SET dossier=json_set(dossier,'$.operator_fingerprint',?) WHERE id=?",
                (value, session),
            )

    def record_enrollment(self, session, confirmation):
        with self.db:
            self.db.execute(
                """UPDATE sessions SET dossier=json_set(dossier,'$.enrollment',
                json_object('verified_by','analyst','timestamp',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                'confirmation',json(?))) WHERE id=?""",
                (json.dumps(confirmation), session),
            )

    def directory(self, prefix, after):
        rows = self.db.execute(
            """
            SELECT account AS account_id, COUNT(*) AS transfers,
                   COUNT(DISTINCT json_extract(event,'$.map_point.operator_id')) AS operators
            FROM sessions WHERE account > ? AND substr(account,1,length(?))=?
            GROUP BY account ORDER BY account LIMIT 51
        """,
            (after, prefix, prefix),
        ).fetchall()
        return {
            "accounts": [dict(row) for row in rows[:50]],
            "next": rows[49]["account_id"] if len(rows) > 50 else None,
        }

    def snapshot(self, account=None):
        account_clause = "WHERE s.account=?" if account else ""
        rows = self.db.execute(
            f"""SELECT s.id, s.event,
                      json_extract(s.dossier,'$.match_confidence') confidence,
                      json_extract(s.dossier,'$.linked_account_ids') accounts,
                      json_extract(s.dossier,'$.policy.step_up_threshold') threshold,
                      json_extract(s.dossier,'$.ml_mode') mode,
                      json_type(s.dossier,'$.enrollment') enrolled,
                      b.status ban
               FROM sessions s LEFT JOIN bans b
                 ON b.operator=json_extract(s.event,'$.map_point.operator_id')
                AND b.mode=json_extract(s.dossier,'$.ml_mode')
               {account_clause} ORDER BY s.rowid DESC LIMIT 200""",
            (account,) if account else (),
        )
        events, identity = [], {}
        for row in rows:
            event = json.loads(row["event"])
            events.append(event)
            identity[row["id"]] = {
                "match_confidence": row["confidence"],
                "linked_account_ids": json.loads(row["accounts"] or "[]"),
                "eligible_for_enrollment": (
                    row["mode"] == "live"
                    and row["ban"] is None
                    and row["enrolled"] is None
                    and row["threshold"] is not None
                    and eligible_for_enrollment(event, row["threshold"])
                ),
            }
        kpis = self.db.execute("""
            SELECT sessions, held_amount AS held_amount_kzt, (SELECT COUNT(*) FROM observed_rings) AS ring_count,
                   inference_sum / NULLIF(inference_count,0) AS average_inference_ms
            FROM dashboard_totals WHERE id=1
        """).fetchone()
        return events, dict(kpis), identity

    def set_ban(self, operator, mode, status):
        with self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO bans VALUES (?,?,?)", (operator, mode, status)
            )

    def ban_status(self, operator, mode):
        row = self.db.execute(
            "SELECT status FROM bans WHERE operator=? AND mode=?", (operator, mode)
        ).fetchone()
        return row["status"] if row else None

    def guardian_holds(self, account):
        rows = self.db.execute(
            """SELECT id, account, amount, event, decision, frozen, acknowledged FROM sessions
            WHERE account=? AND json_extract(decision,'$.ui_mode') IN ('MIRAGE_HOLD','STEALTH_HOLD')
            ORDER BY rowid DESC LIMIT 200""",
            (account,),
        )
        return [
            {
                "session_id": r["id"],
                "account_id": r["account"],
                "amount_kzt": r["amount"],
                "reference_code": json.loads(r["decision"])["reference_code"],
                "urgent": json.loads(r["decision"])["ui_mode"] == "STEALTH_HOLD",
                "acknowledged": bool(r["acknowledged"]),
                "status": "frozen" if r["frozen"] else "held",
                "timestamp": json.loads(r["event"])["timestamp"],
            }
            for r in rows
        ]

    def guardian_action(self, account, session, freeze):
        with self.db:
            cursor = self.db.execute(
                """UPDATE sessions SET acknowledged=1, frozen=MAX(frozen,?)
                WHERE id=? AND account=? AND json_extract(decision,'$.ui_mode') IN ('MIRAGE_HOLD','STEALTH_HOLD')""",
                (int(freeze), session, account),
            )
        return cursor.rowcount == 1
