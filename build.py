#!/usr/bin/env python3
"""Inline web/ + data/rates.json into one offline file: dist/powerwall-solar.html."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def main():
    rates_path = os.path.join(HERE, "data", "rates.json")
    with open(rates_path, encoding="utf-8") as f:
        rates = json.load(f)
    rates_js = json.dumps(rates, ensure_ascii=False)
    html = rd("web/index.html")
    html = html.replace("/*__CSS__*/", rd("web/app.css"))
    html = html.replace("/*__RATES__*/ null /*__/RATES__*/", rates_js)
    app = rd("web/app.js").replace("</script", "<\\/script")
    html = html.replace("/*__APP__*/", app)
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "powerwall-solar.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"built {out} ({os.path.getsize(out):,} bytes) · plans={len(rates.get('plans', []))}")


if __name__ == "__main__":
    main()
