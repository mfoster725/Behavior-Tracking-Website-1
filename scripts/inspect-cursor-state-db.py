"""Read-only inspection of Cursor state.vscdb."""
import json
import os
import sqlite3
from collections import defaultdict

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()

cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
print("Tables:", [r[0] for r in cur.fetchall()])

for table in ("ItemTable", "cursorDiskKV"):
    try:
        cur.execute(f"SELECT COUNT(*), COALESCE(SUM(length(value)),0) FROM {table}")
        n, total = cur.fetchone()
        print(f"\n{table}: {n} rows, {total/1024/1024/1024:.2f} GB total value bytes")
    except sqlite3.OperationalError as e:
        print(f"\n{table}: {e}")

# Key prefixes and sizes
for table in ("ItemTable", "cursorDiskKV"):
    try:
        cur.execute(f"SELECT key, length(value) FROM {table}")
        prefixes = defaultdict(lambda: [0, 0])
        for key, sz in cur.fetchall():
            if ":" in key:
                p = key.split(":")[0] + ":"
            else:
                p = key[:40] if len(key) > 40 else key
            prefixes[p][0] += 1
            prefixes[p][1] += sz
        print(f"\n--- {table} top prefixes by total size ---")
        for p, (cnt, sz) in sorted(prefixes.items(), key=lambda x: -x[1][1])[:20]:
            print(f"  {sz/1024/1024:9.1f} MB  {cnt:6d} keys  {p}")
    except sqlite3.OperationalError:
        pass

# Sample composerData for timestamp fields
for table in ("cursorDiskKV", "ItemTable"):
    try:
        cur.execute(
            f"SELECT key, value FROM {table} WHERE key LIKE 'composerData:%' LIMIT 3"
        )
        rows = cur.fetchall()
        if rows:
            print(f"\n--- sample composerData from {table} ---")
            for key, val in rows:
                print("key:", key[:80])
                try:
                    text = val.decode("utf-8") if isinstance(val, bytes) else val
                    obj = json.loads(text)
                    print("json keys:", list(obj.keys())[:20])
                    for tk in ("createdAt", "lastUpdatedAt", "updatedAt", "timestamp", "created_at"):
                        if tk in obj:
                            print(f"  {tk}:", obj[tk])
                except Exception as e:
                    print("  parse:", e)
    except sqlite3.OperationalError:
        pass

conn.close()
print("\nDB path:", db)
