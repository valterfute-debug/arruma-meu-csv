export const PRICE = 49.99;
export const CURRENCY = "BRL";
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function addMonth(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth()+1);
  const last = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));
  return date.toISOString();
}
export function checkContract(contract, account, collector) {
  return String(contract.id) === String(account.provider_id) &&
    String(contract.external_reference) === String(account.checkout_ref) &&
    String(contract.collector_id) === String(collector) &&
    Number(contract.auto_recurring?.transaction_amount) === PRICE &&
    contract.auto_recurring?.currency_id === CURRENCY &&
    Number(contract.auto_recurring?.frequency) === 1 &&
    contract.auto_recurring?.frequency_type === "months";
}
export function paidThrough(invoice, payment, account, collector, liveMode, now = Date.now()) {
  if (String(invoice.preapproval_id) !== account.provider_id ||
      String(invoice.payment?.id) !== String(payment.id) ||
      payment.status !== "approved" || payment.currency_id !== CURRENCY ||
      Number(payment.transaction_amount) !== PRICE ||
      Number(payment.transaction_amount_refunded || 0) > 0 ||
      String(payment.collector_id) !== String(collector) ||
      payment.live_mode !== liveMode ||
      !Number.isFinite(Date.parse(payment.date_approved)) ||
      Date.parse(payment.date_approved) > now ||
      Number(invoice.transaction_amount) !== PRICE || invoice.currency_id !== CURRENCY ||
      !Number.isFinite(Date.parse(invoice.debit_date)) ||
      Date.parse(invoice.debit_date) > now) return null;
  return addMonth(invoice.debit_date);
}
export async function validSignature(url, headers, secret) {
  const id = url.searchParams.get("data.id");
  const requestId = headers.get("x-request-id");
  const parts = Object.fromEntries((headers.get("x-signature") || "").split(",").map(x=>x.trim().split("=")));
  if (!secret || !id || !requestId || !/^\d+$/.test(parts.ts || "") || !/^[a-f0-9]{64}$/i.test(parts.v1 || "")) return false;
  const manifest = "id:"+id.toLowerCase()+";request-id:"+requestId+";ts:"+parts.ts+";";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const signature = Uint8Array.from(parts.v1.match(/../g),v=>parseInt(v,16));
  // Authentic retries are allowed: handlers re-read provider state and never extend
  // access by delivery time, so replay cannot mint additional subscription periods.
  return crypto.subtle.verify("HMAC",key,signature,enc.encode(manifest));
}
export async function readJson(request, maxBytes = 4096) {
  const reader=request.body?.getReader();
  if(!reader) return {};
  const chunks=[]; let length=0;
  while(true) {
    const {done,value}=await reader.read();
    if(done) break;
    length+=value.length;
    if(length>maxBytes) { await reader.cancel(); throw new HttpError(413,"Solicitação muito grande."); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(length); let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  try {return JSON.parse(new TextDecoder().decode(bytes));}
  catch {throw new HttpError(400,"Solicitação inválida.");}
}
