"""Provision pseudonymous logins and issue revocable, role-scoped sessions."""

import argparse
import getpass
import hashlib
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

TTL = 8 * 3600
ALIAS = re.compile(r"[a-zA-Z0-9_-]{3,48}")


def initialize(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS login_accounts (
            alias TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('mobile','analyst')),
            salt BLOB NOT NULL, verifier BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_sessions (
            digest TEXT PRIMARY KEY, alias TEXT NOT NULL, expires INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS login_expiry ON login_sessions(expires);
    """)


def verifier(password, salt):
    return hashlib.scrypt(
        password.encode(), salt=salt, n=2**15, r=8, p=1, maxmem=64 * 1024**2
    )


def provision(db, alias, password, role):
    if not ALIAS.fullmatch(alias) or not 12 <= len(password) <= 128:
        raise ValueError(
            "Use a 3–48 character fictional alias and a 12–128 character password."
        )
    salt = secrets.token_bytes(16)
    with db:
        db.execute(
            "INSERT INTO login_accounts VALUES (?,?,?,?)",
            (alias, role, salt, verifier(password, salt)),
        )


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db, alias):
    token = secrets.token_urlsafe(32)
    with db:
        db.execute("DELETE FROM login_sessions WHERE expires <= ?", (time.time(),))
        db.execute(
            "INSERT INTO login_sessions VALUES (?,?,?)",
            (digest(token), alias, time.time() + TTL),
        )
    return token


def principal(db, token, role):
    row = (
        db.execute(
            """SELECT a.alias FROM login_sessions s JOIN login_accounts a
                        ON a.alias=s.alias WHERE s.digest=? AND s.expires>? AND a.role=?""",
            (digest(token), time.time(), role),
        ).fetchone()
        if token
        else None
    )
    return row[0] if row else None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=["mobile", "analyst"])
    parser.add_argument("alias")
    parser.add_argument(
        "--database",
        default=os.getenv("SANA_DB", str(Path(__file__).parent / "data/demo.sqlite3")),
    )
    args = parser.parse_args()
    Path(args.database).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.database) as db:
        initialize(db)
        provision(db, args.alias, getpass.getpass("Password: "), args.role)
