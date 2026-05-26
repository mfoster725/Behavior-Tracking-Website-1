"""
Shrink Cursor state.vscdb after a prune that failed at VACUUM (e.g. disk full).
Run only while Cursor is fully quit.

1. Deletes state.vscdb.backup if present (~30 GB on C:)
2. Compacts state.vscdb (VACUUM or VACUUM INTO if C: is still tight)
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from datetime import datetime

GS = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage")
DB = os.path.join(GS, "state.vscdb")
BACKUP = DB + ".backup"
LOG = os.path.join(os.environ["TEMP"], "cursor-finish-vacuum.log")
VACUUM_TEMP = os.path.join(GS, "state.vscdb.vacuum-temp")


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def ensure_cursor_stopped() -> None:
    import subprocess

    out = subprocess.check_output(
        ["powershell", "-NoProfile", "-Command", "(Get-Process -Name 'Cursor*' -EA SilentlyContinue).Count"],
        text=True,
    ).strip()
    if out != "0":
        raise SystemExit("Cursor is still running. Use File > Exit, then run again.")


def disk_free(path: str) -> int:
    return shutil.disk_usage(os.path.splitdrive(os.path.abspath(path))[0] or path).free


def db_stats(conn: sqlite3.Connection) -> tuple[int, int, int]:
    page_count = conn.execute("PRAGMA page_count").fetchone()[0]
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    freelist = conn.execute("PRAGMA freelist_count").fetchone()[0]
    return page_count, page_size, freelist


def remove_duplicate_backup() -> None:
    if not os.path.isfile(BACKUP):
        log("state.vscdb.backup not present (already removed).")
        return
    size_gb = os.path.getsize(BACKUP) / 1024**3
    log(f"Deleting duplicate backup ({size_gb:.2f} GB): {BACKUP}")
    os.remove(BACKUP)
    log("Deleted state.vscdb.backup")


def compact_database() -> None:
    before = os.path.getsize(DB)
    log(f"DB file before: {before / 1024**3:.2f} GB")

    conn = sqlite3.connect(DB, timeout=120)
    conn.execute("PRAGMA journal_mode=DELETE")
    pages, page_size, freelist = db_stats(conn)
    used_bytes = (pages - freelist) * page_size
    free_bytes = freelist * page_size
    log(f"Logical data: {used_bytes / 1024**3:.2f} GB, reclaimable free pages: {free_bytes / 1024**3:.2f} GB")

    c_free = disk_free(DB)
    log(f"C: free before VACUUM: {c_free / 1024**3:.2f} GB")

    # In-place VACUUM briefly needs ~old_file + ~new_file on the same drive.
    need_inplace = before + used_bytes + (512 * 1024**2)
    if c_free >= need_inplace:
        log("Running in-place VACUUM...")
        conn.execute("VACUUM")
        conn.close()
    else:
        log(
            f"C: may be too tight for in-place VACUUM (need ~{need_inplace / 1024**3:.1f} GB, have {c_free / 1024**3:.1f} GB). "
            "Trying VACUUM INTO beside the DB..."
        )
        conn.close()
        if os.path.isfile(VACUUM_TEMP):
            os.remove(VACUUM_TEMP)
        conn2 = sqlite3.connect(DB, timeout=120)
        conn2.execute(f"VACUUM INTO '{VACUUM_TEMP.replace(chr(92), '/')}'")
        conn2.close()
        new_size = os.path.getsize(VACUUM_TEMP)
        if disk_free(DB) < new_size + (256 * 1024**2):
            raise SystemExit(
                f"Not enough space to swap compacted DB ({new_size / 1024**3:.2f} GB). "
                "Delete state.vscdb.backup first or free more space on C:."
            )
        os.replace(VACUUM_TEMP, DB)

    for ext in ("-wal", "-shm"):
        p = DB + ext
        if os.path.isfile(p):
            os.remove(p)
            log(f"Removed {p}")

    after = os.path.getsize(DB)
    log(f"DB file after: {after / 1024**3:.2f} GB")
    log(f"Reclaimed on disk: {(before - after) / 1024**3:.2f} GB")
    log(f"C: free now: {disk_free(DB) / 1024**3:.2f} GB")


def main() -> int:
    open(LOG, "w").close()
    log("Finish Cursor VACUUM (post-prune)")
    ensure_cursor_stopped()

    if not os.path.isfile(DB):
        log(f"DB not found: {DB}")
        return 1

    remove_duplicate_backup()
    compact_database()
    log("Done. Reopen Cursor.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"ERROR: {e}")
        print(f"ERROR: {e}", file=sys.stderr)
        raise
