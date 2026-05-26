import os
import sqlite3

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()

cur.execute(
    "SELECT key, length(value) FROM cursorDiskKV WHERE key LIKE 'agentKv:%' ORDER BY length(value) DESC LIMIT 15"
)
print("Top agentKv keys:")
for k, sz in cur.fetchall():
    print(f"  {(sz or 0)/1024/1024:.1f} MB  {k[:120]}")

cur.execute("SELECT key FROM cursorDiskKV WHERE key LIKE 'agentKv:%' LIMIT 25")
print("\nSample agentKv keys:")
for (k,) in cur.fetchall():
    print(" ", k[:140])

cur.execute("SELECT key FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' LIMIT 8")
print("\nSample bubbleId keys:")
for (k,) in cur.fetchall():
    parts = k.split(":")
    print(" ", k[:100], "| parts:", len(parts))

conn.close()
