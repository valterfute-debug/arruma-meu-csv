"""Run: python tests/browser.py (requires Playwright and installed Chrome)."""
import functools, http.server, json, pathlib, threading, sys
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
artifacts = ROOT / ".test-artifacts"
artifacts.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width":1440,"height":1000}, reduced_motion="reduce")
    errors, requests = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append((r.method,r.url)))
    page.goto(f"http://127.0.0.1:{server.server_port}")
    page.screenshot(path=str(artifacts/"desktop.png"), full_page=False)
    def upload(content, name="dados.csv", mime="text/csv", error=False):
        page.locator("#csvFile").set_input_files({"name":name,"mimeType":mime,"buffer":content.encode("utf-8") if isinstance(content,str) else content})
        if page.locator("#analyzeBtn").is_enabled():
            page.locator("#analyzeBtn").click()
        page.wait_for_function("document.querySelector('#status').dataset.kind === " + ("'error'" if error else "'success'"))
    upload('nome;valor;vazia\nAna;1;\nBia;2;\nBia;2;\nCaio;4;\nDuda;erro;')
    assert page.locator("#columnTable tbody tr").count()==3
    assert "1 inconsistência" in page.locator("#columnTable").inner_text()
    assert page.locator("#results").is_visible()
    page.locator("#whatsappBtn").click()
    assert "CONFIG.whatsappNumber" in page.locator("#whatsappNotice").inner_text()
    usage=json.loads(page.evaluate("localStorage.getItem('arrumameucsv:usage:v1')"))
    assert set(usage)=={"analyses","lastFileBytes"} and usage["analyses"]==1
    upload('"<img src=x onerror=alert(1)>",valor\n"<script>alert(1)</script>",1\nB,2')
    assert page.locator("#results img, #results script").count()==0
    upload('a,b\n"hello, world","first\nsecond"\nother,third')
    upload("a\tb\n1\t2\n3\t4")
    upload("a|b\n1|2\n3|4")
    upload("single\nalpha\nbeta")
    upload("a,b",error=True)
    upload('a,b\n"unclosed,2',error=True)
    upload("a,b\n1,2,3",error=True)
    upload("",error=True)
    upload("a,b\n1,2",name="arquivo.xlsx",error=True)
    page.evaluate("() => { const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(50*1024*1024+1)],'large.csv',{type:'text/csv'})); const input=document.querySelector('#csvFile'); input.files=dt.files; input.dispatchEvent(new Event('change')); }")
    assert page.locator("#status").get_attribute("data-kind")=="error"
    assert "50 MiB" in page.locator("#status").inner_text()
    upload("nome,valor\nJoão,1\nMaria,2".encode("cp1252"),error=True)
    page.locator("#importOptions").evaluate("(element) => { element.open=true; }")
    page.locator("#encoding").select_option("windows-1252")
    upload("nome,valor\nJoão,1\nMaria,2".encode("cp1252"))
    page.locator("#encoding").select_option("utf-8")
    page.evaluate("""() => { const dt=new DataTransfer();dt.items.add(new File(['a,b\\n1,2\\n3,4'],'drop.csv',{type:'text/csv'}));document.querySelector('#dropZone').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt})); }""")
    page.locator("#analyzeBtn").click()
    page.wait_for_function("document.querySelector('#status').dataset.kind === 'success'")
    assert "drop.csv" in page.locator("#resultFile").inner_text()
    page.evaluate("window.open = (...args) => { window.openedArgs=args; }; CONFIG.whatsappNumber='5511999999999'")
    page.locator("#whatsappBtn").click()
    assert page.evaluate("window.openedArgs[0].startsWith('https://wa.me/5511999999999?text=')")
    assert "drop.csv" not in page.evaluate("window.openedArgs[0]")
    for width in [320,375,390,768,1440]:
        page.set_viewport_size({"width":width,"height":844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
    page.set_viewport_size({"width":390,"height":844})
    page.screenshot(path=str(artifacts/"mobile-results.png"),full_page=False)
    page.locator("#clearStats").click()
    assert page.evaluate("localStorage.getItem('arrumameucsv:usage:v1')")==None
    page.evaluate("() => { Storage.prototype.setItem=()=>{throw Error('blocked')}; }")
    upload("a,b\n1,2\n3,4")

    # Optional real file stays outside the repository and is never served over HTTP.
    if len(sys.argv)>1:
        page.locator("#csvFile").set_input_files(sys.argv[1])
        page.locator("#analyzeBtn").click()
        page.wait_for_function("document.querySelector('#status').dataset.kind === 'success'")
        assert "630" in page.locator("#metrics").inner_text()
        assert "3 linhas" in page.locator("#importNotes").inner_text()
        assert page.locator("#columnTable tbody tr").count()==25
        page.locator("#nextColumns").click()
        assert "26–50" in page.locator("#columnPage").inner_text()
        page.locator("#columnSearch").fill("1987")
        assert "16 colunas" in page.locator("#columnPage").inner_text()
        assert page.locator("#columnTable tbody tr").count()==16
        page.locator("#columnSearch").fill("inexistente")
        assert "Nenhuma coluna" in page.locator("#columnPage").inner_text()
        page.locator("#columnSearch").fill("")
        for width in [320,390,768,1440]:
            page.set_viewport_size({"width":width,"height":900})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.set_viewport_size({"width":390,"height":844})
        page.locator("#columnDetails").scroll_into_view_if_needed()
        page.screenshot(path=str(artifacts/"ibge-mobile.png"))
    page.locator("#newAnalysisBtn").click()
    assert page.locator("#results").is_hidden()
    assert page.locator("#step1").get_attribute("aria-current")=="step"
    assert page.locator("#selectFileBtn").is_enabled()
    page.locator("#csvFile").set_input_files({"name":"cancel.csv","mimeType":"text/csv","buffer":b"a,b\n1,2\n3,4"})
    page.evaluate("() => { document.querySelector('#analyzeBtn').click(); document.querySelector('#cancelBtn').click(); }")
    assert "cancelada" in page.locator("#status").inner_text()
    assert page.locator("#progressPanel").is_hidden()
    assert page.locator("#analyzeBtn").is_enabled()
    upload("a,b\n1,2\n3,4")
    assert page.locator("#step3").get_attribute("aria-current")=="step"
    assert not errors,errors
    assert all(method=="GET" and url.startswith(f"http://127.0.0.1:{server.server_port}") for method,url in requests), requests
    print("PASS: CSV flow, formats, errors, XSS, WhatsApp, storage, privacy and 5 viewport widths.")
    browser.close()
server.shutdown()
