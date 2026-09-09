import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHmac} from "node:crypto";
import {createHandler} from "../supabase/functions/saas/handler.mjs";
import {addMonth,paidThrough,validSignature,readJson} from "../supabase/functions/saas/policy.mjs";
import {cleanCSV} from "../supabase/functions/saas/cleaner.mjs";
const require=createRequire(import.meta.url);
const Papa=require("../assets/vendor/papaparse.min.js");
const {prepareTable}=require("../analyzer.js");
const USER="11111111-1111-4111-8111-111111111111";
const REF="22222222-2222-4222-8222-222222222222";
const NOW=Date.parse("2026-09-09T12:00:00Z");
const OPTIONS={trim:true,deduplicate:true,removeEmptyColumns:true,standardizeHeaders:true};
function fixture(overrides={}) {
  const state={
    account:{user_id:USER,checkout_ref:REF,provider_id:"sub1",state:"authorized",paid_until:null},
    contract:{id:"sub1",external_reference:REF,collector_id:42,status:"authorized",auto_recurring:{transaction_amount:49.99,currency_id:"BRL",frequency:1,frequency_type:"months"},init_point:"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=sub1",next_payment_date:"2026-10-09T10:00:00Z"},
    invoice:{id:7,preapproval_id:"sub1",debit_date:"2026-09-09T10:00:00Z",transaction_amount:"49.99",currency_id:"BRL",payment:{id:8,status:"approved"}},
    payment:{id:8,collector_id:42,live_mode:false,status:"approved",currency_id:"BRL",transaction_amount:49.99,transaction_amount_refunded:0,date_approved:"2026-09-09T10:01:00Z"},
    calls:[],createCount:0,limit:true,...overrides
  };
  const values={SUPABASE_URL:"https://unit.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-server-key",APP_URL:"https://site.test/",MP_ACCESS_TOKEN:"test-mp",MP_WEBHOOK_SECRET:"test-signature",MP_COLLECTOR_ID:"42",MP_LIVE_MODE:"false",BILLING_ENABLED:"true"};
  const respond=(data,status=200)=>new Response(JSON.stringify(data),{status});
  async function fetcher(input,options={}) {
    const url=new URL(input),path=url.pathname;
    const body=options.body?JSON.parse(options.body):null;
    state.calls.push({url:input,method:options.method,body});
    if(path==="/auth/v1/user") return options.headers.Authorization==="Bearer valid.token"?respond({id:USER,email:"member@example.test",email_confirmed_at:"2026-09-01"}):respond({},401);
    if(path==="/rest/v1/rpc/consume_api_limit") return respond(state.limit);
    if(path==="/rest/v1/rpc/claim_checkout") {
      if(state.account.state==="creating" || state.account.provider_id) return respond({},409);
      state.account={...state.account,checkout_ref:REF,state:"creating"};return respond(state.account);
    }
    if(path==="/rest/v1/billing_accounts") {
      if(options.method==="PATCH") {state.account={...state.account,...body};return respond([state.account]);}
      return respond(state.account?[state.account]:[]);
    }
    if(path==="/rest/v1/profiles") return respond([{full_name:"Pessoa Teste",phone:"+5511999999999"}]);
    if(path==="/preapproval/search") return respond({results:state.searchResults || []});
    if(path==="/preapproval" && options.method==="POST") {
      state.createCount++;state.created=body;
      state.contract={...state.contract,...body,id:"sub1",collector_id:42};
      return respond(state.contract);
    }
    if(path==="/preapproval/sub1") {if(options.method==="PUT")state.contract={...state.contract,...body};return respond(state.contract);}
    if(path==="/authorized_payments/search") return respond({results:[state.invoice],paging:{total:1}});
    if(path==="/authorized_payments/7") return respond(state.invoice);
    if(path==="/v1/payments/8") return respond(state.payment);
    throw new Error("Unexpected endpoint "+input);
  }
  const handler=createHandler({env:name=>values[name],fetcher,Papa,prepareTable,now:()=>NOW});
  const call=async(action,body={},extra={})=>{
    const response=await handler(new Request("https://unit.supabase.co/functions/v1/saas?action="+action,{method:"POST",headers:{Origin:"https://site.test",Authorization:"Bearer valid.token","Content-Type":"application/json",...extra},body:JSON.stringify(body)}));
    return {status:response.status,data:await response.json()};
  };
  return {state,call,handler,values};
}
test("unauthenticated and cross-origin callers cannot clean",async()=>{
 const f=fixture();
 assert.equal((await f.call("clean",{}, {Authorization:"Bearer invalid"})).status,401);
 assert.equal((await f.call("clean",{}, {Origin:"https://attacker.test"})).status,403);
});
test("authorized contract without approved payment does not unlock Pro",async()=>{
 const f=fixture();f.state.payment.status="pending";
 assert.equal((await f.call("status")).data.pro,false);
 assert.equal((await f.call("clean",{consent:true,text:"a\n1"})).status,403);
});
test("paid member can clean and export; original input remains intact",async()=>{
 const f=fixture(),text=" Nome ;vazia;Valor\n Ana ;;1\n Ana ;;1\n Bia ;;2";
 const result=await f.call("clean",{consent:true,text,options:OPTIONS,outputDelimiter:";"});
 assert.equal(result.status,200);assert.equal(result.data.summary.duplicates,1);assert.equal(result.data.summary.removedColumns,1);
 assert.match(result.data.csv,/nome;valor/);assert.equal(result.data.summary.outputRows,2);
 assert.ok(f.state.calls.every(c=>!c.url.includes("storage")));
});
test("amount, currency, collector, live mode and refunds fail closed",async()=>{
 for(const changed of [{transaction_amount:1},{currency_id:"USD"},{collector_id:9},{live_mode:true},{transaction_amount_refunded:1},{status:"refunded"}]) {
  const f=fixture();Object.assign(f.state.payment,changed);
  assert.equal((await f.call("status")).data.pro,false,JSON.stringify(changed));
 }
});
test("expired paid period and future invoice do not unlock Pro",async()=>{
 const f=fixture();f.state.invoice.debit_date="2026-08-01T00:00:00Z";
 assert.equal((await f.call("status")).data.pro,false);
 f.state.invoice.debit_date="2026-10-01T00:00:00Z";
 assert.equal((await f.call("status")).data.pro,false);
});
test("checkout fixes amount and binds email and identity on server",async()=>{
 const f=fixture();f.state.account={user_id:USER,state:"none",provider_id:null,paid_until:null};
 const result=await f.call("checkout",{acceptRecurring:true,price:0.01,user_id:"attacker",email:"attacker@test"});
 assert.equal(result.status,200);assert.equal(f.state.createCount,1);
 assert.equal(f.state.created.auto_recurring.transaction_amount,49.99);
 assert.equal(f.state.created.auto_recurring.frequency_type,"months");assert.equal(f.state.created.payer_email,"member@example.test");
 assert.equal((await f.call("checkout",{acceptRecurring:true})).status,200);assert.equal(f.state.createCount,1);
});
test("uncertain checkout is not duplicated",async()=>{
 const f=fixture();f.state.account={user_id:USER,checkout_ref:REF,state:"creating",provider_id:null};
 assert.equal((await f.call("checkout",{acceptRecurring:true})).status,409);assert.equal(f.state.createCount,0);
});
test("explicit recurrence and processing consent required",async()=>{
 const f=fixture();
 assert.equal((await f.call("checkout")).status,400);
 assert.equal((await f.call("clean",{text:"a\n1",options:OPTIONS,outputDelimiter:";"})).status,400);
});
test("cancellation stops renewal and preserves paid period",async()=>{
 const f=fixture();const r=await f.call("cancel",{confirm:true});
 assert.equal(r.status,200);assert.equal(r.data.state,"cancelled");assert.equal(r.data.pro,true);assert.equal(r.data.nextBilling,null);
});
test("signed webhook replay cannot extend access and refund revokes it",async()=>{
 const f=fixture();const url=new URL("https://unit.supabase.co/functions/v1/saas?action=webhook&data.id=7");
 const ts="1704908010",requestId="request-1";
 const signature=createHmac("sha256","test-signature").update("id:7;request-id:"+requestId+";ts:"+ts+";").digest("hex");
 const req=()=>new Request(url,{method:"POST",headers:{"x-request-id":requestId,"x-signature":"ts="+ts+",v1="+signature},body:JSON.stringify({type:"subscription_authorized_payment",data:{id:"7"}})});
 assert.equal((await f.handler(req())).status,200);const first=f.state.account.paid_until;
 assert.equal((await f.handler(req())).status,200);assert.equal(f.state.account.paid_until,first);
 f.state.payment.status="refunded";await f.handler(req());assert.equal(f.state.account.paid_until,null);
 assert.equal((await f.handler(new Request(url,{method:"POST",body:"{}"}))).status,401);
});
test("rate limiting applies before protected operation",async()=>{
 const f=fixture();f.state.limit=false;
 assert.equal((await f.call("clean")).status,429);
});
test("calendar month clamps leap days and month endings",()=>{
 assert.equal(addMonth("2024-01-31T10:00:00Z"),"2024-02-29T10:00:00.000Z");
 assert.equal(addMonth("2026-01-31T10:00:00Z"),"2026-02-28T10:00:00.000Z");
});
test("clean export escapes formulas and creates unique safe headers",()=>{
 const r=cleanCSV({consent:true,text:'Á,Á,vazia\n"=HYPERLINK(1)",x,\n+123,y,',options:OPTIONS,outputDelimiter:","},Papa,prepareTable);
 assert.match(r.csv,/a,a_2/);assert.ok(r.csv.includes("'=HYPERLINK"));assert.ok(r.csv.includes("'+123"));
});
test("cleaner rejects irregular files and enforces size",()=>{
 assert.throws(()=>cleanCSV({consent:true,text:"a,b\n1",options:OPTIONS,outputDelimiter:";"},Papa,prepareTable));
 assert.throws(()=>cleanCSV({consent:true,text:"x".repeat(5*1024*1024+1),options:OPTIONS,outputDelimiter:";"},Papa,prepareTable));
});
test("request parser enforces actual streamed size, not content-length",async()=>{
 await assert.rejects(readJson(new Request("https://test",{method:"POST",body:JSON.stringify({x:"x".repeat(50)})}),20),/grande/);
});
