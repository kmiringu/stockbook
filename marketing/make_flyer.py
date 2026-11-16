# Builds flyer.html (2 A5 flyers per A4). Needs: pip install segno. Then print flyer.html to PDF from Chrome.
import io, segno
url = "https://kmiringu.github.io/stockbook/rods.html"
qr = segno.make(url, error="q"); b = io.BytesIO(); qr.save(b, kind="svg", scale=10, border=0, omitsize=True, dark="#111", xmldecl=False)
svg = b.getvalue().decode().replace("<svg ", '<svg class="qr" ', 1)
flyer = f"""<section class="f">
 <div class="top"><div class="k">FUNDI KANGA · GIKAMBURA</div><h1>HERO WELDING RODS</h1><div class="in">● IN STOCK NOW: packet, box or bulk</div></div>
 <div class="mid">
  <table>
   <tr><td>1 packet</td><td>KES 1,200</td></tr>
   <tr><td>1 box <small>(4 packets)</small></td><td>KES 4,700</td></tr>
   <tr class="best"><td>5+ boxes</td><td>KES 4,600 <small>/box</small></td></tr>
   <tr><td>Hardware shops <small>(20+ boxes)</small></td><td>Call for trade price</td></tr>
  </table>
  <div class="q">{svg}<div>Scan for prices<br>&amp; to order</div></div>
 </div>
 <div class="call">Call / WhatsApp <b>0732 906 591</b></div>
</section>"""
css = """@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"DejaVu Sans",Arial,sans-serif;color:#111}
.sheet{width:210mm;height:297mm;display:flex;flex-direction:column}
.f{height:148.5mm;padding:11mm 13mm 9mm;display:flex;flex-direction:column}
.f:first-child{border-bottom:.3mm dashed #999}
.top{background:#1c1c1a;color:#fff;border-radius:4mm;padding:6mm 7mm}
.k{color:#fb923c;font-weight:800;letter-spacing:.16em;font-size:9.5pt}
h1{margin:1.5mm 0 1.5mm;font-size:30pt;letter-spacing:.01em;line-height:1}
.in{color:#86efac;font-weight:700;font-size:11pt}
.mid{display:flex;gap:7mm;align-items:center;margin-top:6mm;flex:1}
table{border-collapse:collapse;flex:1;font-size:13pt}td{padding:2.3mm 1mm;border-bottom:.3mm solid #ddd}td:last-child{text-align:right;font-weight:800}
small{font-weight:400;color:#555;font-size:9.5pt}
tr.best td{color:#c2410c;font-size:14.5pt}
.q{text-align:center;font-size:9.5pt;font-weight:700;color:#333}.qr{width:38mm;height:38mm;display:block;margin:0 auto 2mm}
.call{margin-top:5mm;background:#c2410c;color:#fff;border-radius:4mm;text-align:center;font-size:19pt;padding:4mm}
.call b{font-size:23pt;letter-spacing:.02em}"""
open("flyer.html", "w").write(f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body><div class='sheet'>{flyer}{flyer}</div></body></html>")
