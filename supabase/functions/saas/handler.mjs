import { PRICE, CURRENCY, HttpError, checkContract, paidThrough, validSignature, readJson } from "./policy.mjs";
import { cleanCSV } from "./cleaner.mjs";

export function createHandler({env, fetcher=fetch, Papa, prepareTable, now=()=>Date.now()}) {
  const required=name=>{const value=env(name);if(!value) throw new HttpError(503,"Serviço ainda não configurado. Tente novamente mais tarde.");return value;};
  async function external(url, init={}) {
    try {
      const response=await fetcher(url,{...init,signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new HttpError(response.status===429?429:502,"Não foi possível confirmar os dados no serviço. Tente novamente.");
      if(response.status===204) return null;
      return await response.json();
    } catch(error) {
      if(error instanceof HttpError) throw error;
      throw new HttpError(502,"O serviço não respondeu a tempo. Confira o estado da operação antes de repetir.");
    }
  }
  const db=(path,method="GET",body)=>external(required("SUPABASE_URL")+"/rest/v1/"+path,{
    method,headers:{apikey:required("SUPABASE_SERVICE_ROLE_KEY"),Authorization:"Bearer "+required("SUPABASE_SERVICE_ROLE_KEY"),"Content-Type":"application/json",Prefer:"return=representation"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const mp=(path,method="GET",body,extra={})=>external("https://api.mercadopago.com"+path,{
    method,headers:{Authorization:"Bearer "+required("MP_ACCESS_TOKEN"),"Content-Type":"application/json",...extra},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const query=values=>new URLSearchParams(values).toString();
  async function getAccount(userId) {
    const rows=await db("billing_accounts?"+query({user_id:"eq."+userId,select:"*"}));
    return rows[0] || {user_id:userId,state:"none",provider_id:null,paid_until:null};
  }
  async function updateAccount(account, values) {
    const rows=await db("billing_accounts?"+query({user_id:"eq."+account.user_id,checkout_ref:"eq."+account.checkout_ref}),"PATCH",{...values,updated_at:new Date(now()).toISOString()});
    if(!rows?.length) throw new HttpError(409,"A assinatura mudou durante a operação. Atualize a página.");
    return rows[0];
  }
  async function limited(userId,action,limit) {
    const allowed=await db("rpc/consume_api_limit","POST",{p_user:userId,p_action:action,p_limit:limit});
    if(!allowed) throw new HttpError(429,"Muitas solicitações. Aguarde um minuto e tente novamente.");
  }
  async function invoices(providerId) {
    const results=[];
    for(let offset=0;offset<1000;offset+=50) {
      const page=await mp("/authorized_payments/search?"+query({preapproval_id:providerId,limit:"50",offset:String(offset)}));
      if(!Array.isArray(page.results)) throw new HttpError(502,"Não foi possível conferir a assinatura.");
      results.push(...page.results);
      if(offset+page.results.length>=Number(page.paging?.total ?? results.length)) return results;
      if(!page.results.length) break;
    }
    throw new HttpError(502,"Não foi possível concluir a conferência das cobranças.");
  }
  async function refresh(account) {
    // Recover a timed-out creation by its unique, server-generated reference.
    if(!account.provider_id && account.state==="creating") {
      const search=await mp("/preapproval/search?"+query({external_reference:account.checkout_ref}));
      const matches=(search.results || []).filter(s=>String(s.external_reference)===account.checkout_ref);
      if(matches.length>1) throw new HttpError(409,"Há mais de um contrato para esta operação. Procure o atendimento antes de pagar.");
      if(matches.length===1) account=await updateAccount(account,{provider_id:String(matches[0].id)});
    }
    if(!account.provider_id) return {...account,pro:false};
    const contract=await mp("/preapproval/"+encodeURIComponent(account.provider_id));
    if(!checkContract(contract,account,required("MP_COLLECTOR_ID"))) throw new HttpError(409,"A assinatura não corresponde ao plano contratado. Procure o atendimento.");
    let until=null;
    const all=await invoices(account.provider_id);
    for(const invoice of all) {
      if(!invoice.payment?.id) continue;
      // An invoice from a previous period cannot grant current access.
      const debit=Date.parse(invoice.debit_date);
      if(!Number.isFinite(debit) || debit<now()-35*86400000 || debit>now()) continue;
      const payment=await mp("/v1/payments/"+encodeURIComponent(invoice.payment.id));
      const end=paidThrough(invoice,payment,account,required("MP_COLLECTOR_ID"),env("MP_LIVE_MODE")==="true",now());
      if(end && (!until || end>until)) until=end;
    }
    const state=contract.status;
    const saved=await updateAccount(account,{state,paid_until:until});
    const pro=["authorized","paused","cancelled"].includes(state) && Date.parse(until || "")>now();
    return {...saved,pro,checkoutUrl:contract.init_point,nextBilling:state==="authorized"?contract.next_payment_date:null};
  }
  function publicStatus(account) {
    return {pro:account.pro===true,state:account.state,paidUntil:account.paid_until || null,nextBilling:account.nextBilling || null,price:PRICE,currency:CURRENCY};
  }
  function safeCheckout(url) {
    try {
      const parsed=new URL(url);
      if(parsed.protocol==="https:" && parsed.hostname==="www.mercadopago.com.br" && parsed.pathname.startsWith("/subscriptions/")) return parsed.href;
    } catch { /* Deny any unrecognized redirect. */ }
    throw new HttpError(502,"O endereço de pagamento não foi reconhecido. Procure o atendimento.");
  }
  async function authenticate(request) {
    const authorization=request.headers.get("Authorization") || "";
    if(!/^Bearer [A-Za-z0-9._-]+$/.test(authorization)) throw new HttpError(401,"Entre na sua conta para continuar.");
    let user;
    try {user=await external(required("SUPABASE_URL")+"/auth/v1/user",{headers:{apikey:required("SUPABASE_SERVICE_ROLE_KEY"),Authorization:authorization}});}
    catch {throw new HttpError(401,"Sua sessão expirou. Entre novamente.");}
    if(!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id) || !user.email_confirmed_at) throw new HttpError(401,"Confirme seu e-mail e entre novamente.");
    return user;
  }
  async function webhook(request,url) {
    if(!await validSignature(url,request.headers,required("MP_WEBHOOK_SECRET"))) throw new HttpError(401,"Assinatura da notificação inválida.");
    const body=await readJson(request);
    const id=url.searchParams.get("data.id");
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || String(body.data?.id).toLowerCase()!==id.toLowerCase()) throw new HttpError(400,"Notificação inválida.");
    let providerId=null, contract=null;
    if(body.type==="subscription_preapproval") {
      contract=await mp("/preapproval/"+encodeURIComponent(id));
      providerId=String(contract.id);
    } else if(body.type==="subscription_authorized_payment") {
      const invoice=await mp("/authorized_payments/"+encodeURIComponent(id));
      providerId=String(invoice.preapproval_id || "");
    } else if(body.type==="payment") {
      const search=await mp("/authorized_payments/search?"+query({payment_id:id}));
      const invoice=(search.results || []).find(i=>String(i.payment?.id)===id);
      providerId=invoice?.preapproval_id;
    } else return {received:true};
    if(!providerId) return {received:true};
    contract=contract || await mp("/preapproval/"+encodeURIComponent(providerId));
    // Provider state, not the webhook body, supplies identity and monetary facts.
    if(!/^[0-9a-f-]{36}$/i.test(String(contract.external_reference))) return {received:true};
    const rows=await db("billing_accounts?"+query({checkout_ref:"eq."+contract.external_reference,select:"*"}));
    if(!rows.length) return {received:true};
    let account=rows[0];
    if(!account.provider_id) {
      const candidate={...account,provider_id:providerId};
      if(!checkContract(contract,candidate,required("MP_COLLECTOR_ID"))) throw new HttpError(400,"Contrato inválido.");
      account=await updateAccount(account,{provider_id:providerId});
    }
    if(account.provider_id!==providerId) throw new HttpError(409,"Contrato divergente.");
    await refresh(account);
    return {received:true};
  }
  return async request=>{
    const url=new URL(request.url);
    const action=url.searchParams.get("action") || "status";
    const origin=request.headers.get("Origin");
    let allowedOrigin="";
    try {allowedOrigin=new URL(required("APP_URL")).origin;} catch { /* Request below fails closed. */ }
    const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type"};
    if(origin===allowedOrigin) headers["Access-Control-Allow-Origin"]=allowedOrigin;
    const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    try {
      if(request.method==="OPTIONS") return new Response(null,{status:origin===allowedOrigin?204:403,headers});
      if(request.method!=="POST") throw new HttpError(405,"Método não permitido.");
      if(action==="webhook") return response(await webhook(request,url));
      if(!allowedOrigin || origin!==allowedOrigin) throw new HttpError(403,"Origem não autorizada.");
      if(!["profile","status","checkout","cancel","clean"].includes(action)) throw new HttpError(404,"Operação não encontrada.");
      const user=await authenticate(request);
      await limited(user.id,action,action==="clean"?6:20);
      if(action==="profile") {
        const profiles=await db("profiles?"+query({id:"eq."+user.id,select:"full_name,phone"}));
        return response({email:user.email,profile:profiles[0] || null});
      }
      let account=await getAccount(user.id);
      if(action==="status") return response(publicStatus(await refresh(account)));
      if(action==="checkout") {
        if(env("BILLING_ENABLED")!=="true") throw new HttpError(503,"As assinaturas ainda não estão disponíveis para contratação.");
        const input=await readJson(request);
        if(input.acceptRecurring!==true) throw new HttpError(400,"Confirme o valor mensal e a renovação automática.");
        account=await refresh(account);
        if(account.pro) throw new HttpError(409,"Seu período Pro já está ativo.");
        if(account.provider_id && account.state==="pending") return response({url:safeCheckout(account.checkoutUrl)});
        if(account.provider_id && account.state!=="cancelled") throw new HttpError(409,"Você já tem uma assinatura. Confira o pagamento ou cancele a renovação antes de contratar outra.");
        if(account.provider_id) account=await updateAccount(account,{provider_id:null,paid_until:null,state:"none"});
        let claimed;
        try {claimed=await db("rpc/claim_checkout","POST",{p_user:user.id});}
        catch {throw new HttpError(409,"Já existe uma contratação em andamento. Atualize o estado da assinatura antes de tentar novamente.");}
        // A network error leaves 'creating' intact. Never create a second charge
        // just because the first provider response was lost.
        const contract=await mp("/preapproval","POST",{
          reason:"ArrumaMeuCSV Pro — mensal",
          external_reference:claimed.checkout_ref,payer_email:user.email,
          auto_recurring:{frequency:1,frequency_type:"months",transaction_amount:PRICE,currency_id:CURRENCY},
          back_url:required("APP_URL").split("#")[0].split("?")[0]+"?billing=return#conta",status:"pending"
        },{"X-Idempotency-Key":claimed.checkout_ref});
        const candidate={...claimed,provider_id:String(contract.id)};
        if(!checkContract(contract,candidate,required("MP_COLLECTOR_ID"))) throw new HttpError(502,"Não foi possível validar o contrato. Atualize a assinatura antes de repetir.");
        await updateAccount(claimed,{provider_id:String(contract.id),state:contract.status});
        return response({url:safeCheckout(contract.init_point)});
      }
      if(action==="cancel") {
        const input=await readJson(request);
        if(input.confirm!==true) throw new HttpError(400,"Confirme o cancelamento da renovação.");
        account=await refresh(account);
        if(!account.provider_id) throw new HttpError(409,"Nenhuma assinatura disponível para cancelar.");
        if(account.state!=="cancelled") await mp("/preapproval/"+encodeURIComponent(account.provider_id),"PUT",{status:"cancelled"});
        return response(publicStatus(await refresh(account)));
      }
      if(action==="clean") {
        account=await refresh(account);
        if(!account.pro) throw new HttpError(403,"A limpeza e a exportação exigem uma assinatura Pro com pagamento confirmado.");
        const input=await readJson(request,32*1024*1024);
        return response(cleanCSV(input,Papa,prepareTable));
      }
      throw new HttpError(404,"Operação não encontrada.");
    } catch(error) {
      // Do not log auth tokens, CSVs, user profiles or provider payloads.
      return response({error:error instanceof HttpError?error.message:"Não foi possível concluir a operação. Tente novamente."},error instanceof HttpError?error.status:500);
    }
  };
}
