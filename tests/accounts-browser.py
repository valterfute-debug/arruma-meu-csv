"""Browser checks with mocked providers. No real account, email or charge is created."""
import functools, http.server, json, pathlib, threading, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{server.server_port}/"
artifacts=ROOT/".test-artifacts"
artifacts.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel="chrome",headless=True)
    page=browser.new_page(viewport={"width":390,"height":844},reduced_motion="reduce")
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.goto(base)
    page.locator("#accountNavBtn").click()
    assert page.locator("#authDialog").is_visible()
    page.locator("#signupTab").click()
    assert page.locator("#accountName").is_visible()
    assert page.locator("#accountPhone").is_visible()
    assert "preparação" in page.locator("#authStatus").inner_text()
    page.screenshot(path=str(artifacts/"signup-mobile.png"))
    page.locator("#closeAuthBtn").click()
    page.close()
    state={"pro":False,"state":"none","requests":[]}
    page=browser.new_page(viewport={"width":1280,"height":900},reduced_motion="reduce")
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.on("dialog",lambda dialog:dialog.accept())
    page.route("**/app-config.js",lambda route:route.fulfill(content_type="application/javascript",body='window.APP_CONFIG={supabaseUrl:"https://unit.supabase.co",supabasePublishableKey:"sb_publishable_test"};'))
    def provider(route):
        request=route.request
        headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS"}
        if request.method=="OPTIONS":
            route.fulfill(status=204,headers=headers)
            return
        path=urlparse(request.url).path
        body=request.post_data_json if request.post_data else {}
        state["requests"].append((path,body))
        status=200
        if path.endswith("/signup"):
            data={"user":{"id":"user-test"}}
        elif path.endswith("/token"):
            data={"access_token":"valid.token","refresh_token":"refresh-token","expires_in":3600}
        elif path.endswith("/user"):
            data={"id":"user-test","email":"teste@example.test","email_confirmed_at":"2026-09-09"}
        elif path.endswith("/saas"):
            action=parse_qs(urlparse(request.url).query)["action"][0]
            if action=="profile":
                data={"email":"teste@example.test","profile":{"full_name":"Pessoa Teste","phone":"+5511999999999"}}
            elif action=="checkout":
                data={"url":"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=test"}
            elif action=="clean":
                if not state["pro"]:
                    status=403;data={"error":"A limpeza exige assinatura Pro com pagamento confirmado."}
                else:
                    data={"csv":"nome;valor\r\nAna;1","headers":["nome","valor"],"preview":[["Ana","1"]],"notes":["Revise antes de usar."],"summary":{"inputRows":2,"outputRows":1,"duplicates":1,"trimmed":2,"removedColumns":0,"renamedHeaders":1}}
            else:
                if action=="cancel":state["state"]="cancelled"
                data={"pro":state["pro"],"state":state["state"],"paidUntil":"2026-10-09T00:00:00Z" if state["pro"] else None,"nextBilling":None,"price":49.99,"currency":"BRL"}
        else:
            data={}
        route.fulfill(status=status,headers=headers,content_type="application/json",body=json.dumps(data))
    page.route("https://unit.supabase.co/**",provider)
    page.route("https://www.mercadopago.com.br/**",lambda route:route.fulfill(body="<title>Checkout de teste</title>"))
    page.goto(base)
    page.locator("#accountNavBtn").click()
    page.locator("#signupTab").click()
    page.locator("#accountName").fill("Pessoa Teste")
    page.locator("#accountEmail").fill("teste@example.test")
    page.locator("#accountPhone").fill("+55 11 99999-9999")
    page.locator("#accountPassword").fill("SenhaDeTeste12345")
    page.locator("#togglePasswordBtn").click()
    assert page.locator("#accountPassword").get_attribute("type")=="text"
    page.locator("#accountPrivacy").check()
    page.locator("#authSubmitBtn").click()
    page.wait_for_function("document.querySelector('#authStatus').dataset.kind==='success'")
    assert page.locator("#accountPassword").input_value()==""
    signup=next(body for path,body in state["requests"] if path.endswith("/signup"))
    assert signup["data"]["phone"]=="+5511999999999"
    assert page.evaluate("localStorage.getItem('password')")==None
    page.locator("#loginTab").click()
    page.locator("#accountEmail").fill("teste@example.test")
    page.locator("#accountPassword").fill("SenhaDeTeste12345")
    page.locator("#authSubmitBtn").click()
    page.locator("#conta").wait_for(state="visible")
    page.wait_for_function("document.querySelector('#planBadge').textContent==='GRATUITO'")
    page.locator("#subscribeBtn").click()
    assert "Confirme" in page.locator("#accountStatus").inner_text()
    page.locator("#recurringConsent").check()
    page.locator("#subscribeBtn").click()
    page.wait_for_url("https://www.mercadopago.com.br/**")
    page.goto(base)
    page.locator("#conta").wait_for(state="visible")
    page.locator("#csvFile").set_input_files({"name":"teste.csv","mimeType":"text/csv","buffer":b"nome,valor\nAna,1\nAna,1"})
    page.locator("#analyzeBtn").click()
    page.wait_for_function("document.querySelector('#status').dataset.kind==='success'")
    before=sum(1 for path,body in state["requests"] if "text" in body)
    assert before==0
    page.locator("#cleanConsent").check()
    page.locator("#cleanBtn").click()
    page.wait_for_function("document.querySelector('#proStatus').dataset.kind==='error'")
    assert "assinatura Pro" in page.locator("#proStatus").inner_text()
    state["pro"]=True;state["state"]="authorized"
    page.locator("#refreshPlanBtn").click()
    page.wait_for_function("document.querySelector('#planBadge').textContent==='PRO ATIVO'")
    page.locator("#cleanBtn").click()
    page.locator("#cleanResult").wait_for(state="visible")
    assert "2 → 1" in page.locator("#cleanSummary").inner_text()
    with page.expect_download() as download:
        page.locator("#downloadCleanBtn").click()
    assert download.value.suggested_filename=="teste-limpo.csv"
    for width in [320,390,768,1280]:
        page.set_viewport_size({"width":width,"height":900})
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    page.set_viewport_size({"width":390,"height":844})
    page.locator("#proTools").scroll_into_view_if_needed()
    page.screenshot(path=str(artifacts/"pro-mobile.png"))
    page.locator("#cancelPlanBtn").click()
    page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('Renovação cancelada')")
    assert page.locator("#cancelPlanBtn").is_hidden()
    page.locator("#signOutBtn").click()
    page.locator("#conta").wait_for(state="hidden")
    assert page.locator("#cleanResult").is_hidden()
    assert page.evaluate("sessionStorage.getItem('arrumameucsv:auth:v1')")==None
    page.locator("#accountNavBtn").click()
    page.locator("#forgotPasswordBtn").click()
    page.locator("#accountEmail").fill("teste@example.test")
    page.locator("#authSubmitBtn").click()
    page.wait_for_function("document.querySelector('#authStatus').dataset.kind==='success'")
    page.goto(base+"#access_token=valid.token&refresh_token=refresh-token&expires_in=3600&type=recovery")
    page.wait_for_function("document.querySelector('#authTitle').textContent==='Escolha uma nova senha.'")
    assert "access_token" not in page.url
    page.locator("#accountPassword").fill("OutraSenhaTeste12345")
    page.locator("#authSubmitBtn").click()
    page.wait_for_function("document.querySelector('#authStatus').textContent.includes('Senha atualizada')")
    assert not errors,errors
    print("PASS: signup, login, password reset, checkout, consent, Pro denial, cleaning, download, cancellation, logout and mobile layouts (mock providers).")
    browser.close()
server.shutdown()
