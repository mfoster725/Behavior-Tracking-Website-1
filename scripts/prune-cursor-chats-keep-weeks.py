"""
Prune Cursor global state.vscdb: keep chats from the last N weeks.
Run only while Cursor is fully quit.

Deletes:
  - composerData / bubbleId / checkpointId / codeBlockDiff for old composers
  - agentKv:blob:* not referenced by any remaining row (after composer prune)

Then VACUUM to reclaim disk space.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone, timedelta

WEEKS = int(os.environ.get("CURSOR_PRUNE_WEEKS", "6"))
HASH_RE = re.compile(r"[a-f0-9]{64}")

GS = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage")
DB = os.path.join(GS, "state.vscdb")
LOG = os.path.join(os.environ["TEMP"], "cursor-prune-6weeks.log")


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def parse_ts(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        if val > 1e12:
            val /= 1000
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str) and val.isdigit():
        return parse_ts(int(val))
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def composer_time(obj: dict):
    for k in ("lastUpdatedAt", "updatedAt", "createdAt"):
        if k in obj:
            ts = parse_ts(obj[k])
            if ts:
                return ts
    return None


def ensure_cursor_stopped() -> None:
    import subprocess

    out = subprocess.check_output(
        ["powershell", "-NoProfile", "-Command", "(Get-Process -Name 'Cursor*' -EA SilentlyContinue).Count"],
        text=True,
    ).strip()
    if out != "0":
        raise SystemExit("Cursor is still running. Use File > Exit, then run this script again.")


def optional_backup() -> None:
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    dest_dir = rf"G:\My Drive\Backups\Cursor\pre-prune-{stamp}"
    g_free = shutil.disk_usage("G:\\").free if os.path.exists(r"G:\My Drive") else 0
    db_size = os.path.getsize(DB)
    if g_free < db_size + 2 * 1024**3:
        log(f"Skipping full DB backup (G: free {g_free/1024**3:.1f} GB, need ~{db_size/1024**3:.1f} GB)")
        return
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "state.vscdb")
    log(f"Backing up DB to {dest} ...")
    shutil.copy2(DB, dest)
    log("Backup copy finished.")


def load_composer_sets(conn: sqlite3.Connection, cutoff: datetime):
    keep, prune = set(), set()
    cur = conn.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
    for key, val in cur.fetchall():
        cid = key.split(":", 1)[1]
        try:
            text = val.decode("utf-8") if isinstance(val, bytes) else val
            obj = json.loads(text)
            ts = composer_time(obj)
            if ts and ts >= cutoff:
                keep.add(cid)
            else:
                prune.add(cid)
        except Exception:
            prune.add(cid)
    return keep, prune


def delete_prune_composers(conn: sqlite3.Connection, prune_ids: set[str]) -> int:
    deleted = 0
    batch = 0
    for cid in prune_ids:
        patterns = [
            ("composerData:" + cid, "eq"),
            ("bubbleId:" + cid + ":%", "like"),
            ("checkpointId:" + cid + ":%", "like"),
            ("codeBlockDiff:" + cid + ":%", "like"),
        ]
        for pat, kind in patterns:
            if kind == "eq":
                cur = conn.execute("DELETE FROM cursorDiskKV WHERE key = ?", (pat,))
            else:
                cur = conn.execute("DELETE FROM cursorDiskKV WHERE key LIKE ?", (pat,))
            deleted += cur.rowcount
        batch += 1
        if batch % 50 == 0:
            conn.commit()
            log(f"  composer prune progress: {batch}/{len(prune_ids)}")
    conn.commit()
    return deleted


def collect_referenced_hashes(conn: sqlite3.Connection) -> set[str]:
    refs: set[str] = set()
    cur = conn.execute("SELECT value FROM cursorDiskKV")
    n = 0
    while True:
        rows = cur.fetchmany(500)
        if not rows:
            break
        for (val,) in rows:
            if not val:
                continue
            if isinstance(val, bytes):
                text = val.decode("utf-8", "ignore")
            else:
                text = str(val)
            refs.update(HASH_RE.findall(text))
        n += len(rows)
        if n % 50000 == 0:
            log(f"  scanned {n} rows for blob refs ({len(refs)} hashes)")
    return refs


def disk_free(path: str) -> int:
    return shutil.disk_usage(os.path.splitdrive(os.path.abspath(path))[0] or path).free


def remove_duplicate_backup() -> None:
    backup = DB + ".backup"
    if not os.path.isfile(backup):
        log("state.vscdb.backup not present.")
        return
    size_gb = os.path.getsize(backup) / 1024**3
    log(f"Deleting duplicate backup ({size_gb:.2f} GB): {backup}")
    os.remove(backup)
    log("Deleted state.vscdb.backup")


def compact_database(conn: sqlite3.Connection) -> None:
    before = os.path.getsize(DB)
    pages, page_size, freelist = conn.execute("PRAGMA page_count").fetchone()[0], conn.execute(
        "PRAGMA page_size"
    ).fetchone()[0], conn.execute("PRAGMA freelist_count").fetchone()[0]
    used_bytes = (pages - freelist) * page_size
    log(f"Reclaimable free pages inside DB: {freelist * page_size / 1024**3:.2f} GB")

    remove_duplicate_backup()
    c_free = disk_free(DB)
    log(f"C: free before VACUUM: {c_free / 1024**3:.2f} GB")

    need_inplace = before + used_bytes + (512 * 1024**2)
    vacuum_temp = DB + ".vacuum-temp"
    if c_free >= need_inplace:
        log("Running in-place VACUUM (may take several minutes)...")
        conn.execute("VACUUM")
    else:
        log(
            f"C: tight for in-place VACUUM (need ~{need_inplace / 1024**3:.1f} GB). "
            "Using VACUUM INTO temp file..."
        )
        conn.close()
        if os.path.isfile(vacuum_temp):
            os.remove(vacuum_temp)
        conn2 = sqlite3.connect(DB, timeout=120)
        conn2.execute(f"VACUUM INTO '{vacuum_temp.replace(chr(92), '/')}'")
        conn2.close()
        if disk_free(DB) < os.path.getsize(vacuum_temp) + (256 * 1024**2):
            raise SystemExit(
                "Not enough C: space to swap compacted DB. "
                "Run scripts\\finish-cursor-vacuum.py after freeing space, or delete state.vscdb.backup."
            )
        os.replace(vacuum_temp, DB)
        return

    conn.close()


def delete_orphan_agentkv(conn: sqlite3.Connection, refs: set[str]) -> int:
    to_delete = []
    cur = conn.execute("SELECT key FROM cursorDiskKV WHERE key LIKE 'agentKv:blob:%'")
    for (key,) in cur:
        h = key.rsplit(":", 1)[-1]
        if h not in refs:
            to_delete.append(key)
    log(f"Orphan agentKv blobs to delete: {len(to_delete)}")
    chunk = 500
    deleted = 0
    for i in range(0, len(to_delete), chunk):
        batch = to_delete[i : i + chunk]
        conn.executemany("DELETE FROM cursorDiskKV WHERE key = ?", [(k,) for k in batch])
        deleted += len(batch)
        if (i // chunk) % 20 == 0:
            conn.commit()
            log(f"  agentKv delete progress: {deleted}/{len(to_delete)}")
    conn.commit()
    return deleted


def vacuum_only_if_needed() -> bool:
    """True when deletes are done and only compacting remains."""
    if os.environ.get("CURSOR_VACUUM_ONLY", "").strip() in ("1", "true", "yes"):
        return True
    if not os.path.isfile(LOG):
        return False
    try:
        with open(LOG, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return False
    return "Deleted " in text and "orphan agentKv" in text and "database or disk is full" in text


def main() -> int:
    open(LOG, "a").close() if vacuum_only_if_needed() else open(LOG, "w").close()
    log(f"Prune keep last {WEEKS} weeks")
    ensure_cursor_stopped()

    if not os.path.isfile(DB):
        log(f"DB not found: {DB}")
        return 1

    before = os.path.getsize(DB)
    log(f"DB size before: {before/1024**3:.2f} GB")

    if vacuum_only_if_needed():
        log("VACUUM-only mode (prune deletes already completed earlier).")
        conn = sqlite3.connect(DB, timeout=120)
        conn.execute("PRAGMA journal_mode=DELETE")
        compact_database(conn)
    else:
        optional_backup()

        cutoff = datetime.now(timezone.utc) - timedelta(weeks=WEEKS)
        log(f"Cutoff UTC: {cutoff.isoformat()}")

        conn = sqlite3.connect(DB, timeout=60)
        conn.execute("PRAGMA journal_mode=DELETE")

        keep, prune = load_composer_sets(conn, cutoff)
        log(f"Composers: keep={len(keep)}, prune={len(prune)}")

        n_del = delete_prune_composers(conn, prune)
        log(f"Deleted {n_del} composer-linked rows")

        refs = collect_referenced_hashes(conn)
        log(f"Referenced 64-char hashes in remaining data: {len(refs)}")

        n_agent = delete_orphan_agentkv(conn, refs)
        log(f"Deleted {n_agent} orphan agentKv rows")

        compact_database(conn)

    # remove wal/shm if present
    for ext in ("-wal", "-shm"):
        p = DB + ext
        if os.path.isfile(p):
            os.remove(p)
            log(f"Removed {p}")

    after = os.path.getsize(DB)
    log(f"DB size after: {after/1024**3:.2f} GB")
    log(f"Reclaimed: {(before-after)/1024**3:.2f} GB")
    log("Done. Reopen Cursor.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"ERROR: {e}")
        print(f"ERROR: {e}", file=sys.stderr)
        raise
