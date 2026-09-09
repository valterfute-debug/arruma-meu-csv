import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("PostgreSQL migration isolates profiles and protects subscription writes",async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/202609090001_accounts.sql",import.meta.url),"utf8"));
  await db.exec(`
    insert into auth.users values
      ('11111111-1111-4111-8111-111111111111','{"full_name":"Primeira Pessoa","phone":"+5511999999999"}'),
      ('22222222-2222-4222-8222-222222222222','{"full_name":"Segunda Pessoa","phone":"+5511888888888"}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
  `);
  const own=await db.query("select * from public.profiles");
  assert.equal(own.rows.length,1);assert.equal(own.rows[0].full_name,"Primeira Pessoa");
  const changed=await db.query("update public.profiles set full_name='Invadido' where id='22222222-2222-4222-8222-222222222222' returning id");
  assert.equal(changed.rows.length,0);
  await assert.rejects(db.query("update public.profiles set id='33333333-3333-4333-8333-333333333333'"));
  await assert.rejects(db.query("select * from public.billing_accounts"));
  await assert.rejects(db.query("insert into public.billing_accounts(user_id,state,paid_until) values('11111111-1111-4111-8111-111111111111','authorized','2099-01-01')"));
  await assert.rejects(db.query("select public.claim_checkout('11111111-1111-4111-8111-111111111111')"));
  await db.exec("reset role; set role service_role;");
  const claimed=await db.query("select (public.claim_checkout('11111111-1111-4111-8111-111111111111')).state");
  assert.equal(claimed.rows[0].state,"creating");
  await assert.rejects(db.query("select public.claim_checkout('11111111-1111-4111-8111-111111111111')"),/CHECKOUT_ALREADY_EXISTS/);
  assert.equal((await db.query("select public.consume_api_limit('11111111-1111-4111-8111-111111111111','clean',1) as ok")).rows[0].ok,true);
  assert.equal((await db.query("select public.consume_api_limit('11111111-1111-4111-8111-111111111111','clean',1) as ok")).rows[0].ok,false);
  await db.exec("reset role;");
  await assert.rejects(db.query("insert into auth.users values('33333333-3333-4333-8333-333333333333','{\"full_name\":\"X\",\"phone\":\"123\"}')"));
 } finally {await db.close();}
});
