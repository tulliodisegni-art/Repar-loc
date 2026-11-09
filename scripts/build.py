"""Construit le site installable dans _site/ à partir de src/reparloc.html et web/."""
import pathlib, shutil

root = pathlib.Path(__file__).resolve().parent.parent
out = root / "_site"
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(root / "web", out)

page = (root / "src" / "reparloc.html").read_text(encoding="utf-8")
head = """<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Répar'Loc">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script>window.REPARLOC_PWA=true;window.RL_CFG={url:"https://vvxkkqcmjrwytagbxdfg.supabase.co",key:"sb_publishable_A-kJQIoJXxdXmjHF8iM40g_RP6myhMo",link:"https://tulliodisegni-art.github.io/Repar-loc/"};</script>
<script src="vendor/supabase.js"></script>
<script src="vendor/qrcode.js"></script>
<script>if("serviceWorker" in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})});</script>
"""
marker = '<meta name="theme-color" content="#1f5a3d">'
assert marker in page, "repère introuvable dans src/reparloc.html"
page = page.replace(marker, marker + "\n" + head, 1)
(out / "index.html").write_text(page, encoding="utf-8")
print("ok", out / "index.html", len(page))
