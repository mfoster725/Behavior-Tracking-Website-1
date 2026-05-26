"""Estimate bytes freed by 6-week composer-based prune."""
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
cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
for key, val in cur.fetchall():
    cid = key.split(":", 1)[1]
    try:
        text = val.decode("utf-8") if isinstance(val, bytes) else val
        obj = json.loads(text)
        ts = get_composer_time(obj)
        (keep_ids if ts and ts >= cutoff else prune_ids).add(cid)
    except Exception:
        prune_ids.add(cid)

prune_bytes = 0
keep_bytes = 0
unknown_bytes = 0

prefixes = ("bubbleId:", "checkpointId:", "composerData:", "codeBlockDiff:")
cur.execute("SELECT key, length(value) FROM cursorDiskKV")
for key, sz in cur.fetchall():
    sz = sz or 0
    if key.startswith("agentKv:"):
        continue  # handle separately
    matched = False
    for cid in prune_ids:
        if key.startswith(f"bubbleId:{cid}:") or key.startswith(f"checkpointId:{cid}:") or key == f"composerData:{cid}" or key.startswith(f"codeBlockDiff:{cid}:"):
            prune_bytes += sz
            matched = True
            break
    if matched:
        continue
    for cid in keep_ids:
        if key.startswith(f"bubbleId:{cid}:") or key.startswith(f"checkpointId:{cid}:") or key == f"composerData:{cid}" or key.startswith(f"codeBlockDiff:{cid}:"):
            keep_bytes += sz
            matched = True
            break
    if not matched and any(key.startswith(p) for p in prefixes):
        unknown_bytes += sz

cur.execute("SELECT SUM(length(value)) FROM cursorDiskKV WHERE key LIKE 'agentKv:%'")
agent_total = cur.fetchone()[0] or 0

print(f"Composers keep={len(keep_ids)} prune={len(prune_ids)}")
print(f"Prune composer-linked GB: {prune_bytes/1024**3:.2f}")
print(f"Keep composer-linked GB: {keep_bytes/1024**3:.2f}")
print(f"Unknown composer-linked GB: {unknown_bytes/1024**3:.2f}")
print(f"agentKv total GB: {agent_total/1024**3:.2f}")
print(f"Est. after composer prune + VACUUM (no agentKv): {(keep_bytes + unknown_bytes + agent_total)/1024**3:.2f} GB DB payload")
print(f"Est. if also delete all agentKv: {(keep_bytes + unknown_bytes)/1024**3:.2f} GB payload")

conn.close()
