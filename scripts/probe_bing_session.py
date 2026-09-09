"""Probe 2: session cookies + impersonation, then hunt for the async ads endpoint."""
import re
from curl_cffi import requests

keyword = "nordvpn coupon"
url = f"https://www.bing.com/search?q={requests.utils.quote(keyword)}&count=20&mkt=en-US"

s = requests.Session(impersonate="chrome")
r1 = s.get(url, timeout=20)
r2 = s.get(url, timeout=20)
html = r2.text

def count(pattern: str, text: str) -> int:
    return len(re.findall(pattern, text))

print(f"r1 http={r1.status_code} bytes={len(r1.text)} | r2 http={r2.status_code} bytes={len(html)}")
print(
    f"li.b_ad={count(r'<li[^>]*b_ad', html)} "
    f"b_algo={count('b_algo', html)} "
    f"b_adurl={count('b_adurl', html)}"
)

# hunt for async ad endpoints in the shell page
for pat in [r'["\'](/async/[^"\']+)', r'["\']([^"\']*ad[^"\']*\.(?:js|json))["\']', r"bmasync[^,;}]{0,60}", r'"ads[A-Za-z]*Url"\s*:\s*"[^"]+"']:
    hits = sorted(set(re.findall(pat, html)))[:8]
    if hits:
        print(f"pattern {pat!r}:")
        for h in hits:
            print(f"   {h[:120]}")
