"""Database connection for ingest jobs. Uses the owner role (DATABASE_URL_ADMIN), which is not subject to RLS."""
import os
import psycopg


def admin_url():
    url = os.environ.get("DATABASE_URL_ADMIN") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Set DATABASE_URL_ADMIN (see .env.example)")
    return url


def connect(autocommit=False):
    return psycopg.connect(admin_url(), autocommit=autocommit)
