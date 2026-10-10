"""Files stored in Postgres (stored_files). Paths look like 'db:<uuid>'; older rows may hold a disk path."""
import os
import tempfile

PREFIX = "db:"


def store(cur, path, name=None, uploaded_by=None):
    """Store a local file and return its 'db:<uuid>' path. Runs as the owner role (no RLS)."""
    with open(path, "rb") as f:
        data = f.read()
    fid = cur.execute("insert into stored_files (name, size, data, uploaded_by) values (%s, %s, %s, %s) returning id",
                      (name or os.path.basename(path), len(data), data, uploaded_by)).fetchone()[0]
    return f"{PREFIX}{fid}"


def materialize(cur, path, workdir=None):
    """Return a local file path for a stored path (writes a temp copy for 'db:' paths)."""
    if not path:
        return None
    if not path.startswith(PREFIX):
        return path if os.path.exists(path) else None
    row = cur.execute("select name, data from stored_files where id = %s", (path[len(PREFIX):],)).fetchone()
    if not row:
        return None
    name, data = row
    fd, tmp = tempfile.mkstemp(prefix="nzx-", suffix=os.path.splitext(name)[1], dir=workdir)
    with os.fdopen(fd, "wb") as f:
        f.write(bytes(data))
    return tmp


def reference_file(cur, kind, fallback, workdir=None):
    """The national or global list: the copy uploaded on the admin page, else the file on disk."""
    row = cur.execute("select file_id from reference_files where kind = %s", (kind,)).fetchone()
    if row:
        return materialize(cur, f"{PREFIX}{row[0]}", workdir)
    return fallback if fallback and os.path.exists(fallback) else None


def set_reference(cur, kind, path):
    fid = store(cur, path)[len(PREFIX):]
    cur.execute("""insert into reference_files (kind, file_id, name) values (%s, %s, %s)
                   on conflict (kind) do update set file_id = excluded.file_id, name = excluded.name, uploaded_at = now()""",
                (kind, fid, os.path.basename(path)))
