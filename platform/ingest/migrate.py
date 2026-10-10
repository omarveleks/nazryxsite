#!/usr/bin/env python3
"""Apply db/migrations/*.sql in order (once each) and set the app role's password from APP_DB_PASSWORD."""
import glob
import os
import sys

import psycopg
from psycopg import sql

from db import connect

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = os.environ.get("MIGRATIONS_DIR", os.path.join(HERE, "..", "db", "migrations"))


def migrate():
    with connect() as conn:
        conn.execute("create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())")
        done = {r[0] for r in conn.execute("select name from schema_migrations")}
        for path in sorted(glob.glob(os.path.join(MIGRATIONS, "*.sql"))):
            name = os.path.basename(path)
            if name in done:
                continue
            print(f"applying {name}")
            try:
                with conn.transaction():
                    conn.execute(open(path).read())
            except psycopg.errors.InsufficientPrivilege as e:
                raise SystemExit(
                    f"{name}: {e}\nThis database user cannot create roles. Create the app role once as an admin, then rerun:\n"
                    "  CREATE ROLE nazryx_app LOGIN NOBYPASSRLS PASSWORD '<APP_DB_PASSWORD>';") from e
            conn.execute("insert into schema_migrations (name) values (%s)", (name,))
        pw = os.environ.get("APP_DB_PASSWORD")
        if pw:
            try:
                with conn.transaction():
                    conn.execute(sql.SQL("alter role nazryx_app with login password {}").format(sql.Literal(pw)))
            except psycopg.errors.InsufficientPrivilege:
                print("Could not set the nazryx_app password (this database user lacks CREATEROLE). "
                      "Set it once as an admin: ALTER ROLE nazryx_app LOGIN PASSWORD '<APP_DB_PASSWORD>';", file=sys.stderr)
        else:
            print("APP_DB_PASSWORD not set: the app role has no password yet", file=sys.stderr)
        conn.execute("""insert into countries (code, name, enabled) values
            ('TZ', 'Tanzania', true), ('KE', 'Kenya', false), ('UG', 'Uganda', false), ('KZ', 'Kazakhstan', false)
            on conflict (code) do nothing""")
        conn.commit()
    print("migrations up to date")


if __name__ == "__main__":
    migrate()
