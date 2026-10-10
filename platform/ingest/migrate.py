#!/usr/bin/env python3
"""Apply db/migrations/*.sql in order (once each) and set the app role's password from APP_DB_PASSWORD."""
import glob
import os
import sys

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
            conn.execute(open(path).read())
            conn.execute("insert into schema_migrations (name) values (%s)", (name,))
        pw = os.environ.get("APP_DB_PASSWORD")
        if pw:
            conn.execute(sql.SQL("alter role nazryx_app with login password {}").format(sql.Literal(pw)))
        else:
            print("APP_DB_PASSWORD not set: the app role has no password yet", file=sys.stderr)
        conn.execute("""insert into countries (code, name, enabled) values
            ('TZ', 'Tanzania', true), ('KE', 'Kenya', false), ('UG', 'Uganda', false), ('KZ', 'Kazakhstan', false)
            on conflict (code) do nothing""")
        conn.commit()
    print("migrations up to date")


if __name__ == "__main__":
    migrate()
