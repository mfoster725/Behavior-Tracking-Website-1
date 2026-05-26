import json
import os
import re
import sqlite3
from datetime import datetime, timezone, timedelta

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()

BLOB_RE = re.compile(r"[a-f0-9]{64}")

cutoff = datetime.now(timezone.utc) - timedelta(weeks=6)

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

def get_composer_time(obj):
    for k in ("lastUpdatedAt", "updatedAt", "createdAt"):
        if k in obj:
            ts = parse_ts(obj[k])
            if ts:
                return ts
    return None

keep_ids = set()
prune_ids = set()
referenced_blobs = set()

cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
for key, val in cur.fetchall():
    cid = key.split(":", 1)[1]
    try:
        text = val.decode("utf-8") if isinstance(val, bytes) else val
        obj = json.loads(text)
        ts = get_composer_time(obj)
        if ts and ts >= cutoff:
            keep_ids.add(cid)
        else:
            prune_ids.add(cid)
        for h in BLOB_RE.findall(text):
            referenced_blobs.add(h)
    except Exception:
        prune_ids.add(cid)

print(f"keep composers: {len(keep_ids)}, prune: {len(prune_ids)}")

# scan bubbles for keep/prune composer ids and blob refs
bubble_keep = bubble_prune = 0
cur.execute("SELECT key, length(value) FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
for key, sz in cur.fetchall():
    parts = key.split(":")
    if len(parts) < 3:
        continue
    cid = parts[1]
    if cid in keep_ids:
        bubble_keep += sz or 0
    elif cid in prune_ids:
        bubble_prune += sz or 0

print(f"bubbleId size keep: {bubble_keep/1024**3:.2f} GB, prune: {bubble_prune/1024**3:.2f} GB")

# count agentKv blobs
cur.execute("SELECT COUNT(*), SUM(length(value)) FROM cursorDiskKV WHERE key LIKE 'agentKv:blob:%'")
n, total = cur.fetchone()
print(f"agentKv blobs: {n}, total { (total or 0)/1024**3:.2f} GB")

# sample: blobs referenced from keep composers only
print(f"blob hashes found in composerData JSON: {len(referenced_blobs)}")

conn.close()
