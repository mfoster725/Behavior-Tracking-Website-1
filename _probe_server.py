import re
import urllib.request

for path in ("/login", "/"):
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:5000{path}",
            headers={"Cache-Control": "no-cache"},
        )
        html = urllib.request.urlopen(req, timeout=8).read().decode("utf-8", "replace")
        scripts = re.findall(r"app\.js\?v=[\w-]+", html)
        cc = dict(urllib.request.urlopen(req).headers.items()) if False else {}
        print(path, "scripts", scripts or "NONE", "len", len(html))
    except Exception as e:
        print(path, "ERR", e)
