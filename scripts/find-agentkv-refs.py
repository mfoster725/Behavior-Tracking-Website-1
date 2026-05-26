import json
import os
import re
import sqlite3
from datetime import datetime, timezone, timedelta

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()
cutoff = datetime.now(timezone.utc) - timedelta(weeks=6)

def parse_ts(val):
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
        if k in obj and obj[k] is not None:
            ts = parse_ts(obj[k])
            if ts:
                return ts
    return None

keep_ids = set()
cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
for key, val in cur.fetchall():
    cid = key.split(":", 1)[1]
    try:
        text = val.decode("utf-8") if isinstance(val, bytes) else val
        obj = json.loads(text)
        ts = get_composer_time(obj)
        if ts and ts >= cutoff:
            keep_ids.add(cid)
    except Exception:
        pass

refs = set()
BLOB_KEY = re.compile(r"agentKv:blob:([a-f0-9]{64})")
HASH = re.compile(r"[a-f0-9]{64}")

for cid in keep_ids:
    cur.execute("SELECT value FROM cursorDiskKV WHERE key LIKE ?", (f"bubbleId:{cid}:%",))
    for (val,) in cur.fetchall():
        text = val.decode("utf-8", "replace") if isinstance(val, bytes) else str(val)
        refs.update(BLOB_KEY.findall(text))
        refs.update(HASH.findall(text))

print(f"keep composers: {len(keep_ids)}")
print(f"refs from keep bubbles (64hex): {len(refs)}")

# how many agentKv blobs match
if refs:
    placeholders = ",".join("?" * min(len(refs), 500))
    sample = list(refs)[:500]
    q = f"SELECT COUNT(*), SUM(length(value)) FROM cursorDiskKV WHERE key IN ({','.join('?' for _ in sample)})"
    keys = [f"agentKv:blob:{h}" for h in sample]
    cur.execute(q, keys)
    print("matched in first 500 refs:", cur.fetchone())

conn.close()
