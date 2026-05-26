"""Inspect composer chat timestamps in cursorDiskKV."""
import json
import os
import sqlite3
from datetime import datetime, timezone, timedelta

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()

cutoff = datetime.now(timezone.utc) - timedelta(weeks=6)

def parse_ts(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        # ms vs s
        if val > 1e12:
            val = val / 1000
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str):
        if val.isdigit():
            return parse_ts(int(val))
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None

def get_composer_time(obj):
    for path in [
        ("lastUpdatedAt",),
        ("updatedAt",),
        ("createdAt",),
        ("created_at",),
        ("metadata", "lastUpdatedAt"),
        ("metadata", "updatedAt"),
        ("metadata", "createdAt"),
    ]:
        o = obj
        for k in path:
            if not isinstance(o, dict) or k not in o:
                o = None
                break
            o = o[k]
        if o is not None:
            ts = parse_ts(o)
            if ts:
                return ts
    return None

cur.execute("SELECT key, length(value) FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
composers = []
for key, sz in cur.fetchall():
    cid = key.split(":", 1)[1]
    composers.append((cid, sz or 0))

print(f"composerData count: {len(composers)}")
print(f"Total composerData size GB: {sum(c[1] for c in composers)/1024**3:.2f}")

# Fetch bodies in batches for timestamp
times = []
sample_keys = set()
for i, (cid, sz) in enumerate(composers[:5000]):  # cap for speed in inspect
    cur.execute("SELECT value FROM cursorDiskKV WHERE key = ?", (f"composerData:{cid}",))
    row = cur.fetchone()
    if not row or row[0] is None:
        continue
    val = row[0]
    try:
        text = val.decode("utf-8") if isinstance(val, bytes) else val
        obj = json.loads(text)
        ts = get_composer_time(obj)
        if ts:
            times.append((ts, cid, sz))
        elif len(sample_keys) < 3:
            sample_keys.add(cid)
            print("No ts, keys:", list(obj.keys())[:15])
    except Exception as e:
        if len(sample_keys) < 3:
            print("parse err", cid, e)

if times:
    times.sort()
    old = [t for t in times if t[0] < cutoff]
    keep = [t for t in times if t[0] >= cutoff]
    old_bytes = sum(t[2] for t in old)
    keep_bytes = sum(t[2] for t in keep)
    print(f"\nSampled {len(times)} composers with timestamps")
    print(f"Oldest: {times[0][0].isoformat()}")
    print(f"Newest: {times[-1][0].isoformat()}")
    print(f"Keep (>= 6 weeks): {len(keep)} composers, {keep_bytes/1024**3:.2f} GB composerData")
    print(f"Prune (< 6 weeks): {len(old)} composers, {old_bytes/1024**3:.2f} GB composerData")

# Prefix sizes for cursorDiskKV
cur.execute("SELECT key, length(value) FROM cursorDiskKV")
prefix_bytes = {}
prefix_count = {}
for key, sz in cur.fetchall():
    sz = sz or 0
    p = key.split(":")[0] if ":" in key else key[:30]
    prefix_bytes[p] = prefix_bytes.get(p, 0) + sz
    prefix_count[p] = prefix_count.get(p, 0) + 1

print("\n--- cursorDiskKV prefixes ---")
for p in sorted(prefix_bytes, key=lambda x: -prefix_bytes[x])[:15]:
    print(f"  {prefix_bytes[p]/1024**3:7.2f} GB  {prefix_count[p]:7d}  {p}")

conn.close()
