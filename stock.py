#!/usr/bin/env python3
"""Stockbook: stock control driven by WhatsApp group messages.

People type short commands in the group:
    #out 2 box hero for gate project
    #out 3 pkt hero @Kamau          (taken by Kamau, logged by the sender)
    #in 50 box hero                 (new delivery)
    #return 1 pkt hero
    #count 270 box hero             (stock take: sets the balance)

Then the storekeeper exports the chat and runs:
    python3 stock.py sync "WhatsApp Chat with Fuse Store.txt"

Commands:
    sync FILE        read a WhatsApp chat export, add new entries, rebuild reports
    log "MSG" --by NAME [--at "YYYY-MM-DD HH:MM"]   add one entry by hand
    status           print a summary to paste back into the group
    build            rebuild STOCK.md and docs/index.html from the ledger
Standard library only (Python 3.11+).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import re
import sys
import tomllib
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "business.toml"
LEDGER = ROOT / "ledger.csv"
REJECTS = ROOT / "needs-attention.csv"
FIELDS = ["id", "when", "action", "item", "qty", "taken_by", "logged_by", "note", "source", "raw"]
ACTIONS = {"in", "out", "return", "count"}
SIGN = {"in": 1, "return": 1, "out": -1}

# Android: "14/11/2026, 10:23 - Name: text"   iOS: "[14/11/2026, 10:23:45] Name: text"
LINE_RE = re.compile(
    r"^‎?\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+"
    r"(\d{1,2}):(\d{2})(?::\d{2})?[\s ]*([AaPp]\.?[Mm]\.?)?\]?\s*(?:-\s*)?"
    r"([^:]+?):\s(.*)$"
)
CMD_RE = re.compile(r"^#(in|out|return|count)\b\s*(.*)$", re.I)
NUM_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s*(.*)$")


# ---------- config & ledger ----------

def load_config() -> dict:
    with CONFIG.open("rb") as f:
        cfg = tomllib.load(f)
    for it in cfg["items"]:
        it["aliases"] = sorted({a.lower() for a in it["aliases"]} | {it["key"]}, key=len, reverse=True)
        it["units"] = {u.lower(): float(v) for u, v in it["units"].items()}
    return cfg


def read_ledger() -> list[dict]:
    if not LEDGER.exists():
        return []
    with LEDGER.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def append_rows(path: Path, rows: list[dict], fields: list[str]) -> None:
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if new:
            w.writeheader()
        w.writerows(rows)


def balances(rows: list[dict]) -> dict[str, float]:
    bal: dict[str, float] = defaultdict(float)
    for r in rows:
        bal[r["item"]] += float(r["qty"])
    return bal


# ---------- parsing ----------

def match_unit(word: str, item: dict) -> float | None:
    w = word.lower().rstrip(".")
    for cand in (w, w[:-1] if w.endswith("s") else w, w[:-2] if w.endswith("es") else w):
        if cand in item["units"]:
            return item["units"][cand]
    return None


def match_item(text: str, cfg: dict) -> tuple[dict | None, str]:
    low = text.lower()
    best = None
    for it in cfg["items"]:
        for a in it["aliases"]:
            if re.match(rf"{re.escape(a)}\b", low) and (best is None or len(a) > best[1]):
                best = (it, len(a))
    if not best:
        return None, text
    return best[0], text[best[1]:].strip()


def parse_command(text: str, cfg: dict) -> dict:
    """Parse one '#action ...' line. Returns fields, or {'error': reason}."""
    m = CMD_RE.match(text.strip())
    if not m:
        return {"error": "not a command"}
    action, rest = m.group(1).lower(), m.group(2).strip()
    n = NUM_RE.match(rest)
    if not n:
        return {"error": "missing quantity, e.g. #out 2 box hero"}
    qty, unit_word, rest = float(n.group(1)), n.group(2) or "", n.group(3)
    # "#out 3 hero" has no unit word: put the word back in front of the item text
    if unit_word and not any(match_unit(unit_word, it) for it in cfg["items"]):
        rest, unit_word = f"{unit_word} {rest}".strip(), ""
    item, rest = match_item(rest, cfg)
    if not item:
        return {"error": "unknown item: " + (rest.split() or ["?"])[0]}
    factor = match_unit(unit_word, item) if unit_word else 1.0
    if factor is None:
        return {"error": f"unit '{unit_word}' is not set up for {item['name']}"}
    taken_by = ""
    at = re.search(r"@([\w.'-]+(?:\s[A-Z][\w'-]+)?)", rest)
    if at:
        taken_by = at.group(1)
        rest = (rest[: at.start()] + rest[at.end():]).strip()
    note = re.sub(r"^(?:[-:,]|for\b)\s*", "", rest, flags=re.I).strip()
    return {"action": action, "item": item["key"], "base_qty": qty * factor, "taken_by": taken_by, "note": note}


def parse_export(path: Path, cfg: dict) -> list[dict]:
    """Group a WhatsApp export into messages: {when, sender, text}."""
    msgs: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = LINE_RE.match(line)
        if not m:
            if msgs:
                msgs[-1]["text"] += "\n" + line
            continue
        a, b, y, hh, mm, ampm, sender, text = m.groups()
        d, mo = (int(a), int(b)) if cfg["business"].get("date_format", "dmy") == "dmy" else (int(b), int(a))
        y = int(y) + (2000 if len(y) == 2 else 0)
        h = int(hh)
        if ampm:
            h = h % 12 + (12 if ampm.lower().startswith("p") else 0)
        msgs.append({"when": datetime(y, mo, d, h, int(mm)), "sender": sender.strip(), "text": text})
    return msgs


def make_id(when: str, who: str, raw: str) -> str:
    return hashlib.sha1(f"{when}|{who}|{raw}".encode()).hexdigest()[:10]


def ingest(messages: list[dict], cfg: dict, source: str) -> tuple[int, list[dict]]:
    rows = read_ledger()
    seen = {r["id"] for r in rows}
    bal = balances(rows)
    trusted = {t.lower() for t in cfg["business"].get("trusted", [])}
    added, rejects = [], []
    for msg in messages:
        for i, line in enumerate(msg["text"].splitlines()):
            line = line.strip()
            if not line.startswith("#") or not CMD_RE.match(line):
                continue
            when = msg["when"].strftime("%Y-%m-%d %H:%M")
            rid = make_id(when, msg["sender"], f"{i}:{line}")
            if rid in seen:
                continue
            seen.add(rid)
            p = parse_command(line, cfg)
            if "error" not in p and trusted and msg["sender"].lower() not in trusted:
                p = {"error": "sender is not in the trusted list"}
            if "error" in p:
                rejects.append({"id": rid, "when": when, "sender": msg["sender"], "message": line, "problem": p["error"]})
                continue
            if p["action"] == "count":
                qty = p["base_qty"] - bal[p["item"]]
            else:
                qty = SIGN[p["action"]] * p["base_qty"]
            bal[p["item"]] += qty
            added.append({
                "id": rid, "when": when, "action": p["action"], "item": p["item"], "qty": f"{qty:g}",
                "taken_by": p["taken_by"] or (msg["sender"] if p["action"] == "out" else ""),
                "logged_by": msg["sender"], "note": p["note"], "source": source, "raw": line,
            })
    added.sort(key=lambda r: r["when"])
    if added:
        append_rows(LEDGER, added, FIELDS)
    if rejects:
        old = set()
        if REJECTS.exists():
            with REJECTS.open(newline="", encoding="utf-8") as f:
                old = {r["id"] for r in csv.DictReader(f)}
        rejects = [r for r in rejects if r["id"] not in old]
        append_rows(REJECTS, rejects, ["id", "when", "sender", "message", "problem"])
    return len(added), rejects


# ---------- reports ----------

def unit_word(item: dict, unit: str, n: float) -> str:
    w = item.get("words", {}).get(unit, unit)
    if n == 1:
        return w
    return w + ("es" if w.endswith(("x", "s", "ch", "sh")) else "s")


def fmt_qty(base: float, item: dict) -> str:
    """1108 pkt -> '277 boxes'; 11 pkt -> '2 boxes and 3 packets'."""
    big_name, big = sorted(item["units"].items(), key=lambda kv: -kv[1])[0]
    sign, a, b = ("-" if base < 0 else ""), abs(base), item["base_unit"]
    if big > 1 and a >= big:
        whole, part = divmod(a, big)
        s = f"{int(whole):,} {unit_word(item, big_name, whole)}"
        if part:
            s += f" and {part:g} {unit_word(item, b, part)}"
        return sign + s
    return f"{sign}{a:g} {unit_word(item, b, a)}"


def nice_time(when: str) -> str:
    d = datetime.strptime(when, "%Y-%m-%d %H:%M")
    return f"{d:%a %d %b}, {d.hour % 12 or 12}:{d:%M} {'pm' if d.hour >= 12 else 'am'}"


def sentence(r: dict, item: dict) -> str:
    """One ledger row as plain English."""
    e = html.escape
    q = fmt_qty(abs(float(r["qty"])), item)
    who = e(r["taken_by"] or r["logged_by"])
    note = f" ({e(r['note'])})" if r["note"] else ""
    if r["action"] == "out":
        s = f"<b>{who}</b> took <b>{q}</b>{note}"
        if r["logged_by"] and e(r["logged_by"]) != who:
            s += f", posted by {e(r['logged_by'])}"
    elif r["action"] == "in":
        s = f"<b>{q}</b> came into the store{note}"
    elif r["action"] == "return":
        s = f"<b>{who}</b> brought back <b>{q}</b>{note}"
    else:
        diff = float(r["qty"])
        what = "matched the record" if diff == 0 else (f"found {q} {'more' if diff > 0 else 'fewer'} than the record")
        s = f"<b>{e(r['logged_by'])}</b> counted the stock and {what}"
    return s


def summary_rows(cfg: dict, rows: list[dict]) -> list[dict]:
    bal = balances(rows)
    out_total = defaultdict(float)
    for r in rows:
        if r["action"] == "out":
            out_total[r["item"]] += -float(r["qty"])
    res = []
    for it in cfg["items"]:
        b = bal.get(it["key"], 0.0)
        res.append({"item": it, "balance": b, "out": out_total[it["key"]], "value": b * it.get("price", 0),
                    "low": b <= it.get("reorder_at", 0)})
    return res


def whatsapp_status(cfg: dict, rows: list[dict]) -> str:
    cur = cfg["business"].get("currency", "")
    lines = [f"*{cfg['business']['name']} stock* ({datetime.now():%d %b %Y %H:%M})", ""]
    for s in summary_rows(cfg, rows):
        it = s["item"]
        flag = " ⚠️ reorder" if s["low"] else ""
        lines.append(f"• {it['name']}: *{fmt_qty(s['balance'], it)}*{flag}")
        lines.append(f"   taken out so far: {fmt_qty(s['out'], it)} · stock value ≈ {cur} {s['value']:,.0f}")
    recent = [r for r in rows if r["action"] == "out"][-5:]
    if recent:
        lines += ["", "_Last take-outs:_"]
        items = {i["key"]: i for i in cfg["items"]}
        for r in reversed(recent):
            note = f" ({r['note']})" if r["note"] else ""
            lines.append(f"- {nice_time(r['when'])} {r['taken_by']}: {fmt_qty(-float(r['qty']), items[r['item']])}{note}")
    lines += ["", "Took stock? Post: #out 2 box hero for <job>"]
    return "\n".join(lines)


def build(cfg: dict) -> None:
    rows = read_ledger()
    items = {i["key"]: i for i in cfg["items"]}
    cur = cfg["business"].get("currency", "")
    sums = summary_rows(cfg, rows)

    # STOCK.md: readable on GitHub
    md = [f"# {cfg['business']['name']}", "", f"_{cfg['business'].get('subtitle', '')}_", "",
          f"Updated {datetime.now():%Y-%m-%d %H:%M}", "", "| Item | Balance | Taken out | Value |", "|---|---|---|---|"]
    for s in sums:
        it = s["item"]
        md.append(f"| {it['name']}{' ⚠️' if s['low'] else ''} | {fmt_qty(s['balance'], it)} | "
                  f"{fmt_qty(s['out'], it)} | {cur} {s['value']:,.0f} |")
    md += ["", "## Movements (latest first)", "", "| When | Action | Item | Qty | Taken by | Logged by | Note |",
           "|---|---|---|---|---|---|---|"]
    for r in reversed(rows):
        q = float(r["qty"])
        md.append(f"| {r['when']} | {r['action']} | {items[r['item']]['name']} | {'+' if q > 0 else ''}"
                  f"{fmt_qty(q, items[r['item']])} | {r['taken_by']} | {r['logged_by']} | {r['note']} |")
    (ROOT / "STOCK.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    # docs/index.html: plain-language page for the WhatsApp group
    e = html.escape
    by_person = defaultdict(float)
    for r in rows:
        if r["action"] == "out":
            by_person[(r["taken_by"], r["item"])] += -float(r["qty"])
    stock = "".join(
        f'<section class="now{" low" if s["low"] else ""}">'
        f'<div class="lbl">{e(s["item"]["name"])}: in the store now</div>'
        f'<div class="big">{e(fmt_qty(s["balance"], s["item"]))}</div>'
        f'<div class="sub">{s["balance"]:,.0f} {unit_word(s["item"], s["item"]["base_unit"], s["balance"])}'
        f' · worth about {e(cur)} {s["value"]:,.0f}</div>'
        f'<div class="pill">{"Running low. Time to reorder" if s["low"] else "Enough stock"}</div>'
        f'<div class="sub">Taken out so far: {e(fmt_qty(s["out"], s["item"]))}</div></section>'
        for s in sums)
    feed, last_day = [], None
    for r in reversed(rows):
        day = nice_time(r["when"]).split(",")[0]
        if day != last_day:
            feed.append(f'<li class="day">{e(day)}</li>')
            last_day = day
        feed.append(f'<li><span class="t">{e(nice_time(r["when"]).split(", ")[1])}</span>'
                    f'<span class="dot {e(r["action"])}"></span><span>{sentence(r, items[r["item"]])}</span></li>')
    people = "".join(
        f"<tr><td>{e(p or '?')}</td><td class='n'>{e(fmt_qty(q, items[k]))}</td></tr>"
        for (p, k), q in sorted(by_person.items(), key=lambda kv: -kv[1]))
    page = TEMPLATE.format(
        name=e(cfg["business"]["name"]), subtitle=e(cfg["business"].get("subtitle", "")),
        updated=e(nice_time(datetime.now().strftime("%Y-%m-%d %H:%M"))), stock=stock,
        feed="".join(feed) or "<li>Nothing recorded yet.</li>",
        people=people or "<tr><td colspan=2>Nobody yet</td></tr>",
        wa=e(whatsapp_status(cfg, rows)))
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "index.html").write_text(page, encoding="utf-8")


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name}</title>
<style>
:root{{--bg:#f6f5f1;--fg:#1c1c1a;--mut:#67665f;--card:#fff;--line:#e3e1d8;--ok:#15803d;--okbg:#dcfce7;--bad:#b91c1c;--badbg:#fee2e2;--acc:#c2410c}}
@media (prefers-color-scheme:dark){{:root{{--bg:#141412;--fg:#ecebe6;--mut:#a3a29a;--card:#1e1e1b;--line:#34332e;--ok:#4ade80;--okbg:#14532d;--bad:#fca5a5;--badbg:#7f1d1d;--acc:#fb923c}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}}
main{{max-width:720px;margin:auto;padding:24px 16px 56px}}h1{{margin:0;font-size:1.5rem}}h2{{font-size:1.1rem;margin:36px 0 10px}}
.mut,.sub{{color:var(--mut)}}.sub{{font-size:.9rem}}
.now{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-top:18px}}
.lbl{{color:var(--mut);font-size:.9rem}}.big{{font-size:2.4rem;font-weight:750;line-height:1.15;margin:4px 0}}
.pill{{display:inline-block;margin:10px 0 6px;padding:3px 12px;border-radius:99px;font-size:.85rem;font-weight:600;background:var(--okbg);color:var(--ok)}}
.low .pill{{background:var(--badbg);color:var(--bad)}}
.fresh{{margin-top:14px;font-size:.9rem;color:var(--mut)}}
button{{font:inherit;font-size:.9rem;margin-top:10px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}}
ul.feed{{list-style:none;margin:0;padding:0;overflow:hidden;background:var(--card);border:1px solid var(--line);border-radius:14px}}
.feed li{{display:flex;gap:10px;align-items:baseline;padding:10px 16px;border-bottom:1px solid var(--line)}}.feed li:last-child{{border:0}}
.feed li.day{{font-weight:650;font-size:.85rem;color:var(--mut);background:var(--bg);padding:6px 16px}}
.t{{min-width:64px;color:var(--mut);font-size:.85rem;font-variant-numeric:tabular-nums}}
.dot{{width:9px;height:9px;border-radius:50%;flex:none;background:var(--mut);transform:translateY(-1px)}}.dot.out{{background:var(--acc)}}.dot.in,.dot.return{{background:var(--ok)}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}}
td{{padding:10px 16px;border-bottom:1px solid var(--line)}}.n{{text-align:right;font-variant-numeric:tabular-nums}}
ol{{padding-left:20px}}ol li{{margin-bottom:8px}}code{{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:.9em}}
</style></head><body><main>
<h1>{name}</h1><div class="mut">{subtitle}</div>
{stock}
<div class="fresh">Last updated <b>{updated}</b>. Anything posted in the WhatsApp group after that will show at the next update.</div>
<button id="copy">Copy summary for WhatsApp</button><textarea id="wa" hidden>{wa}</textarea>

<h2>What happened</h2>
<ul class="feed">{feed}</ul>

<h2>Total taken by each person</h2>
<table>{people}</table>

<h2>How this works</h2>
<ol>
<li>When you take rods from the store, post in the WhatsApp group straight away:<br><code>#out 2 box hero for &lt;job&gt;</code> or <code>#out 3 pkt hero for &lt;job&gt;</code></li>
<li>Taking for someone else? Add their name: <code>#out 1 box hero @Kamau</code>. Brought some back? <code>#return 1 pkt hero</code></li>
<li>The storekeeper updates this page from the group messages, usually once a day. 1 box = 4 packets.</li>
</ol>
<script>
document.getElementById('copy').onclick=async function(){{
  try{{await navigator.clipboard.writeText(document.getElementById('wa').value);this.textContent='Copied. Paste it in the group'}}
  catch(_){{this.textContent='Copy failed. Select the text manually'}}
}};
</script>
</main></body></html>
"""


# ---------- CLI ----------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync"); s.add_argument("file", type=Path)
    lg = sub.add_parser("log"); lg.add_argument("message"); lg.add_argument("--by", required=True)
    lg.add_argument("--at", help="YYYY-MM-DD HH:MM (default now)")
    sub.add_parser("status"); sub.add_parser("build")
    a = ap.parse_args()
    cfg = load_config()

    if a.cmd == "sync":
        n, rej = ingest(parse_export(a.file, cfg), cfg, "whatsapp")
        print(f"Added {n} new entr{'y' if n == 1 else 'ies'}.")
    elif a.cmd == "log":
        when = datetime.strptime(a.at, "%Y-%m-%d %H:%M") if a.at else datetime.now().replace(second=0, microsecond=0)
        n, rej = ingest([{"when": when, "sender": a.by, "text": a.message}], cfg, "manual")
        print(f"Added {n} entr{'y' if n == 1 else 'ies'}.")
    else:
        rej = []
    for r in rej:
        print(f"  ! {r['when']} {r['sender']}: {r['message']}  -> {r['problem']}", file=sys.stderr)
    if rej:
        print(f"{len(rej)} message(s) need attention (saved in needs-attention.csv).", file=sys.stderr)
    if a.cmd == "status":
        print(whatsapp_status(cfg, read_ledger()))
    else:
        build(cfg)
        print("Rebuilt STOCK.md and docs/index.html")


if __name__ == "__main__":
    main()
