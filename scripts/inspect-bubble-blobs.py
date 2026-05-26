import json
import os
import re
import sqlite3

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()

cur.execute("SELECT key FROM cursorDiskKV WHERE key LIKE 'codeBlockDiff:%' LIMIT 8")
print("codeBlockDiff samples:")
for (k,) in cur.fetchall():
    print(" ", k[:100])

cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 3")
BLOB_RE = re.compile(r"[a-f0-9]{64}")
for key, val in cur.fetchall():
    text = val.decode("utf-8", "replace") if isinstance(val, bytes) else str(val)
    hashes = BLOB_RE.findall(text)
    print(f"\n{key[:80]}")
    print(f"  len={len(text)}, hashes={len(hashes)}, agentKv in text={'agentKv' in text}")
    if hashes:
        print(f"  sample hash: {hashes[0][:16]}...")

conn.close()
