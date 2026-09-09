"""Probe: does chrome-impersonated curl_cffi get server-rendered Bing ads?"""
import re
import sys
from curl_cffi import requests

def count(pattern: str, html: str) -> int:
    return len(re.findall(pattern, html))

keyword = sys.argv[1] if len(sys.argv) > 1 else "nordvpn coupon"
url = f"https://www.bing.com/search?q={requests.utils.quote(keyword)}&count=20&mkt=en-US"

r = requests.get(url, impersonate="chrome", timeout=20)
html = r.text
print(f"http={r.status_code} bytes={len(html)}")
print(
    f"li.b_ad={count(r'<li[^>]*b_ad', html)} "
    f"b_adTop={count('b_adTop', html)} "
    f"b_algo={count('b_algo', html)} "
    f"b_adurl={count('b_adurl', html)}"
)
with open("/tmp/probe_serp.html", "w") as f:
    f.write(html)
print("html -> /tmp/probe_serp.html")
