"use strict";
(() => {
  const el=id=>document.getElementById(id);
  const key="arrumameucsv:auth:v1";
  const config=window.APP_CONFIG || {};
  let session=null, user=null, mode="signup", busy=false, plan=null, poll=null;
  function configured() {
    try {
      const url=new URL(config.supabaseUrl);
      const publicKey=config.supabasePublishableKey || "";
      const validKey=publicKey.startsWith("sb_publishable_") || (()=>{try{return JSON.parse(atob(publicKey.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).role==="anon";}catch{return false;}})();
      return url.protocol==="https:" && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && validKey;
    } catch {return false;}
  }
  function message(id,text,kind="") {el(id).textContent=text;el(id).dataset.kind=kind;}
  function setSession(value) {
    session=value?{access_token:value.access_token,refresh_token:value.refresh_token,expires_at:value.expires_at || Math.floor(Date.now()/1000)+(value.expires_in || 3600)}:null;
    try {if(session) sessionStorage.setItem(key,JSON.stringify(session));else sessionStorage.removeItem(key);} catch { /* Account works in memory if storage is disabled. */ }
  }
  async function authRequest(path,{method="POST",body,token}={}) {
    if(!configured()) throw new Error("Cadastro e assinatura estão em preparação. O diagnóstico gratuito já pode ser usado.");
    let response;
    try {response=await fetch(config.supabaseUrl+"/auth/v1/"+path,{method,headers:{apikey:config.supabasePublishableKey,"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}
    catch {throw new Error("Não foi possível conectar ao cadastro. Confira sua conexão e tente novamente.");}
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      if(response.status===429) throw new Error("Muitas tentativas. Aguarde alguns minutos antes de repetir.");
      if(data.code==="email_not_confirmed" || data.error_code==="email_not_confirmed") throw new Error("Confirme seu e-mail antes de entrar. Você pode reenviar a confirmação abaixo.");
      if(data.code==="weak_password") throw new Error("Escolha uma senha mais forte, com pelo menos 12 caracteres.");
      throw new Error(path.startsWith("token?grant_type=password")?"Não foi possível entrar. Confira e-mail, senha e confirmação de e-mail.":"Não foi possível concluir. Confira os dados e tente novamente.");
    }
    return data;
  }
  async function token() {
    if(!session) throw new Error("Entre na sua conta para continuar.");
    if(session.expires_at<Math.floor(Date.now()/1000)+60) {
      const next=await authRequest("token?grant_type=refresh_token",{body:{refresh_token:session.refresh_token}});
      setSession(next);
    }
    return session.access_token;
  }
  async function api(action,body={}) {
    const accessToken=await token();
    let response;
    try {response=await fetch(config.supabaseUrl+"/functions/v1/saas?action="+encodeURIComponent(action),{
      method:"POST",headers:{apikey:config.supabasePublishableKey,Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},
      body:JSON.stringify(body),signal:AbortSignal.timeout(action==="clean"?90000:60000)
    });} catch {throw new Error("A operação não respondeu. Atualize a assinatura para conferir o estado antes de tentar novamente.");}
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      if(response.status===401) {setSession(null);user=null;updateAccountUI();}
      throw new Error(data.error || "Não foi possível concluir esta operação.");
    }
    return data;
  }
  function updateAccountUI() {
    el("conta").hidden=!user;
    el("accountNavBtn").textContent=user?"Minha conta":"Entrar / Criar conta";
    el("unlockProBtn").hidden=plan?.pro===true && !!user;
    el("accountIdentity").textContent=user?.email || "";
    if(!user) {plan=null;document.dispatchEvent(new Event("account:signedout"));}
  }
  function showMode(next) {
    mode=next;el("authForm").reset();el("accountPassword").type="password";
    el("togglePasswordBtn").textContent="Mostrar";el("togglePasswordBtn").setAttribute("aria-pressed","false");
    el("authTabs").hidden=["recover","newPassword"].includes(mode);
    const signup=mode==="signup", password=mode!=="recover", email=mode!=="newPassword";
    for(const [field,input,show] of [["nameField","accountName",signup],["phoneField","accountPhone",signup],["emailField","accountEmail",email],["passwordField","accountPassword",password],["privacyField","accountPrivacy",signup]]) {
      el(field).hidden=!show;el(input).required=show;
    }
    el("accountPassword").minLength=mode==="login"?1:12;
    el("accountPassword").autocomplete=mode==="login"?"current-password":"new-password";
    el("passwordHelp").hidden=mode==="login";
    el("forgotPasswordBtn").hidden=mode==="newPassword";
    el("resendEmailBtn").hidden=mode!=="login";
    el("signupTab").setAttribute("aria-pressed",String(signup));el("loginTab").setAttribute("aria-pressed",String(mode==="login"));
    const titles={signup:"Crie sua conta.",login:"Bom ter você de volta.",recover:"Recupere seu acesso.",newPassword:"Escolha uma nova senha."};
    const labels={signup:"Criar minha conta",login:"Entrar na minha conta",recover:"Enviar link de recuperação",newPassword:"Salvar nova senha"};
    el("authTitle").textContent=titles[mode];el("authSubmitBtn").textContent=labels[mode];
    el("authDescription").textContent=signup?"O cadastro é gratuito. A assinatura só começa após o pagamento.":mode==="recover"?"Informe seu e-mail para receber as instruções.":"Use seu e-mail e sua senha para acessar a conta.";
    message("authStatus",configured()?"":"Cadastro e assinatura estão em preparação. O diagnóstico gratuito já pode ser usado.");
  }
  function open(next="signup") {
    if(user && next!=="newPassword") {el("conta").scrollIntoView({behavior:"smooth"});return;}
    showMode(next);if(!el("authDialog").open) el("authDialog").showModal();
  }
  async function refreshPlan(silent=false) {
    if(!user) return;
    const expectedUser=user;
    if(!silent) message("accountStatus","Conferindo a assinatura…","loading");
    try {
      const nextPlan=await api("status");
      if(user!==expectedUser) return;
      plan=nextPlan;
      const state=plan.state;
      el("planBadge").textContent=plan.pro?"PRO ATIVO":state==="pending" || state==="creating"?"AGUARDANDO PAGAMENTO":"GRATUITO";
      el("planTitle").textContent=plan.pro?"Suas ferramentas Pro estão disponíveis.":state==="cancelled"?"Renovação cancelada.":"Diagnóstico gratuito disponível.";
      const until=plan.paidUntil?new Date(plan.paidUntil).toLocaleString("pt-BR"):"";
      el("planDescription").textContent=plan.pro?"Acesso pago até "+until+(state==="cancelled"?". A assinatura não será renovada.":"."):(state==="pending" || state==="creating"?"A contratação ainda está pendente. O plano só é liberado após a confirmação do pagamento.":"Assine o Pro para limpar, padronizar e exportar seus arquivos.");
      el("subscribePanel").hidden=plan.pro;
      el("subscribeBtn").disabled=state==="creating" || ["authorized","paused"].includes(state);
      el("subscribeBtn").textContent=state==="pending"?"Retomar pagamento ↗":"Continuar para o pagamento ↗";
      el("cancelPlanBtn").hidden=!["pending","authorized","paused"].includes(state);
      el("unlockProBtn").hidden=plan.pro;
      message("accountStatus",plan.pro?"Assinatura conferida. Você já pode usar as ferramentas Pro.":"Estado da assinatura atualizado.","success");
      document.dispatchEvent(new CustomEvent("account:plan",{detail:plan}));
    } catch(error) {
      plan=null;el("planBadge").textContent="NÃO VERIFICADO";el("planTitle").textContent="Não foi possível confirmar o plano.";
      el("planDescription").textContent="Use Atualizar assinatura para tentar novamente.";message("accountStatus",error.message,"error");
    }
  }
  async function signedIn(data) {
    setSession(data);
    user=await authRequest("user",{method:"GET",token:session.access_token});
    if(!user.email_confirmed_at) {setSession(null);user=null;throw new Error("Confirme seu e-mail antes de continuar.");}
    updateAccountUI();
    if(el("authDialog").open) el("authDialog").close();
    await refreshPlan();
    api("profile").then(data=>{if(user) el("accountIdentity").textContent=(data.profile?.full_name?data.profile.full_name+" · ":"")+data.email;}).catch(()=>{});
    el("conta").scrollIntoView({behavior:"smooth"});
  }
  function redirectURL() {return location.origin+location.pathname;}
  el("authForm").addEventListener("submit",async event=>{
    event.preventDefault();if(busy) return;
    busy=true;el("authSubmitBtn").disabled=true;message("authStatus","Aguarde, estamos processando…","loading");
    const email=el("accountEmail").value.trim(), password=el("accountPassword").value;
    try {
      if(mode==="signup") {
        const phone="+"+el("accountPhone").value.replace(/\D/g,"");
        if(!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Informe telefone com DDI, DDD e número. Exemplo de formato: +55 seguido do DDD e celular.");
        const data=await authRequest("signup?redirect_to="+encodeURIComponent(redirectURL()),{body:{email,password,data:{full_name:el("accountName").value.trim(),phone}}});
        el("accountPassword").value="";
        if(data.access_token) await signedIn(data);
        else {message("authStatus","Se o cadastro puder ser concluído, você receberá um e-mail. Confira sua caixa de entrada e spam, confirme o endereço e entre na conta.","success");el("resendEmailBtn").hidden=false;}
      } else if(mode==="login") {
        await signedIn(await authRequest("token?grant_type=password",{body:{email,password}}));
      } else if(mode==="recover") {
        await authRequest("recover?redirect_to="+encodeURIComponent(redirectURL()),{body:{email}});
        message("authStatus","Se existir uma conta para esse e-mail, você receberá as instruções de recuperação.","success");
      } else {
        await authRequest("user",{method:"PUT",token:await token(),body:{password}});
        el("accountPassword").value="";message("authStatus","Senha atualizada. Você já pode fechar esta janela e usar sua conta.","success");
      }
    } catch(error) {message("authStatus",error.message,"error");}
    finally {busy=false;el("authSubmitBtn").disabled=false;el("accountPassword").value="";}
  });
  el("resendEmailBtn").addEventListener("click",async()=>{
    const email=el("accountEmail");
    if(!email.reportValidity()) return;
    el("resendEmailBtn").disabled=true;
    try {await authRequest("resend?redirect_to="+encodeURIComponent(redirectURL()),{body:{type:"signup",email:email.value.trim()}});message("authStatus","Se houver confirmação pendente, enviaremos um novo e-mail.","success");}
    catch(error){message("authStatus",error.message,"error");}
    finally{el("resendEmailBtn").disabled=false;}
  });
  el("subscribeBtn").addEventListener("click",async()=>{
    if(!el("recurringConsent").checked) {message("accountStatus","Confirme o valor de R$49,99/mês e a renovação automática antes de continuar.","error");el("recurringConsent").focus();return;}
    el("subscribeBtn").disabled=true;message("accountStatus","Preparando seu pagamento no Mercado Pago…","loading");
    try {
      const {url}=await api("checkout",{acceptRecurring:true});
      const target=new URL(url);
      if(target.protocol!=="https:" || target.hostname!=="www.mercadopago.com.br" || !target.pathname.startsWith("/subscriptions/")) throw new Error("Endereço de pagamento inválido.");
      location.assign(target.href);
    } catch(error) {message("accountStatus",error.message,"error");el("subscribeBtn").disabled=false;}
  });
  el("cancelPlanBtn").addEventListener("click",async()=>{
    if(!confirm("Cancelar a renovação de R$49,99/mês? O acesso permanece até o fim do período já pago. Esta ação não solicita reembolso.")) return;
    el("cancelPlanBtn").disabled=true;
    try {await api("cancel",{confirm:true});await refreshPlan();message("accountStatus","Renovação cancelada. Não haverá novas cobranças deste contrato.","success");}
    catch(error){message("accountStatus",error.message,"error");}
    finally{el("cancelPlanBtn").disabled=false;}
  });
  el("refreshPlanBtn").addEventListener("click",async()=>{el("refreshPlanBtn").disabled=true;try{await refreshPlan();}finally{el("refreshPlanBtn").disabled=false;}});
  el("signOutBtn").addEventListener("click",async()=>{
    clearInterval(poll);
    try {if(session) await authRequest("logout?scope=local",{token:await token()});} catch { /* Local sign-out still completes. */ }
    setSession(null);user=null;updateAccountUI();el("accountNavBtn").focus();
  });
  el("signupTab").addEventListener("click",()=>showMode("signup"));
  el("loginTab").addEventListener("click",()=>showMode("login"));
  el("forgotPasswordBtn").addEventListener("click",()=>showMode("recover"));
  el("closeAuthBtn").addEventListener("click",()=>el("authDialog").close());
  el("authPrivacyLink").addEventListener("click",()=>el("authDialog").close());
  el("authDialog").addEventListener("close",()=>{el("accountPassword").value="";});
  el("togglePasswordBtn").addEventListener("click",()=>{
    const shown=el("accountPassword").type==="password";
    el("accountPassword").type=shown?"text":"password";
    el("togglePasswordBtn").textContent=shown?"Ocultar":"Mostrar";
    el("togglePasswordBtn").setAttribute("aria-pressed",String(shown));
    el("togglePasswordBtn").setAttribute("aria-label",shown?"Ocultar senha":"Mostrar senha");
  });
  document.querySelectorAll("[data-open-account]").forEach(button=>button.addEventListener("click",()=>open(button.dataset.openAccount)));
  window.Account={open,api,isSignedIn:()=>!!user,refreshPlan};
  async function handleAuthCallback() {
    const hash=new URLSearchParams(location.hash.slice(1));
    const recovery=hash.get("type")==="recovery";
    if(hash.has("access_token")) {
      history.replaceState(null,"",location.pathname+location.search);
      try {await signedIn({access_token:hash.get("access_token"),refresh_token:hash.get("refresh_token"),expires_in:Number(hash.get("expires_in"))});if(recovery) open("newPassword");}
      catch(error){setSession(null);user=null;updateAccountUI();open("login");message("authStatus",error.message,"error");}
      return true;
    }
    return false;
  }
  window.addEventListener("hashchange",()=>{void handleAuthCallback();});
  (async()=>{
    if(!await handleAuthCallback()) {
      try {const saved=JSON.parse(sessionStorage.getItem(key));if(saved?.access_token && saved?.refresh_token){setSession(saved);await token();await signedIn(session);}}
      catch {setSession(null);user=null;updateAccountUI();}
    }
    if(new URLSearchParams(location.search).get("billing")==="return") {
      if(!user) {open("login");message("authStatus","Entre para conferir sua assinatura. O retorno do pagamento não confirma a cobrança.");}
      else {let attempts=0;poll=setInterval(async()=>{if(++attempts>6 || !user){clearInterval(poll);return;}await refreshPlan(true);if(plan?.pro) clearInterval(poll);},10000);}
    }
  })();
})();
