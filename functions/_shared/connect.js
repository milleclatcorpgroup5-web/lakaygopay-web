import { json, config } from "./superbase.js";
function hexToBytes(hex){if(!/^[0-9a-f]{64}$/i.test(hex||""))throw new Error("CONNECT_SECRET_HASH_INVALID");return Uint8Array.from(hex.match(/.{2}/g).map(x=>parseInt(x,16)));}
function bytesToHex(bytes){return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");}
function safeEqual(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export async function sha256Hex(value){return bytesToHex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));}
export async function serviceRest(env,resourceAndQuery,options={}){
 const backend=config(env);const response=await fetch(backend.url+"/rest/v1/"+resourceAndQuery,{method:options.method||"GET",headers:{
  apikey:backend.secretKey,authorization:"Bearer "+backend.secretKey,accept:"application/json",
  ...(options.body!==undefined?{"content-type":"application/json",prefer:options.prefer||"return=representation"}:{})
 },body:options.body===undefined?undefined:JSON.stringify(options.body)});
 const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{}
 if(!response.ok){const e=new Error("CONNECT_DATABASE_UNAVAILABLE");e.status=response.status>=500?503:400;throw e;}return data;
}
export async function authenticatePartner(request,env){
 const clientId=request.headers.get("x-lgp-client-id")||"",timestamp=request.headers.get("x-lgp-timestamp")||"",signature=request.headers.get("x-lgp-signature")||"";
 if(!/^lgp_test_[a-f0-9-]{30,}$/i.test(clientId))return{error:json({error:"CONNECT_CLIENT_ID_INVALID"},401)};
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Math.floor(Date.now()/1000)-Number(timestamp))>300)return{error:json({error:"CONNECT_TIMESTAMP_INVALID"},401)};
 if(!/^[0-9a-f]{64}$/i.test(signature))return{error:json({error:"CONNECT_SIGNATURE_INVALID"},401)};
 let bodyText="";if(request.method!=="GET"&&request.method!=="HEAD"){bodyText=await request.clone().text();if(bodyText.length>16000)return{error:json({error:"BODY_TOO_LARGE"},413)};}
 let rows;try{rows=await serviceRest(env,"connect_apps?client_id=eq."+encodeURIComponent(clientId)+"&select=id,owner_user_id,merchant_id,app_name,status,mode,capabilities,client_secret_hash&limit=1");}
 catch{return{error:json({error:"CONNECT_DATABASE_UNAVAILABLE"},503)};}
 const app=Array.isArray(rows)?rows[0]:null;if(!app||app.status!=="active"||app.mode!=="sandbox"||!app.client_secret_hash)return{error:json({error:"CONNECT_APP_NOT_ACTIVE"},403)};
 try{
  const key=await crypto.subtle.importKey("raw",hexToBytes(app.client_secret_hash),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const u=new URL(request.url);const canonical=timestamp+"."+request.method.toUpperCase()+"."+u.pathname+u.search+"."+bodyText;
  const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(canonical));
  if(!safeEqual(bytesToHex(digest),signature.toLowerCase()))return{error:json({error:"CONNECT_SIGNATURE_INVALID"},401)};
 }catch{return{error:json({error:"CONNECT_SIGNATURE_INVALID"},401)};}
 let body={};if(bodyText){try{body=JSON.parse(bodyText);}catch{return{error:json({error:"INVALID_JSON"},400)};}if(!body||typeof body!=="object"||Array.isArray(body))return{error:json({error:"INVALID_JSON"},400)};}
 return{app,body};
}
export function validConnectReference(value){return typeof value==="string"&&value.trim().length>=1&&value.trim().length<=120&&/^[A-Za-z0-9._:-]+$/.test(value.trim());}
export function validHttpsUrl(value){if(value==null||value==="")return null;if(typeof value!=="string"||value.length>500)return undefined;try{const u=new URL(value),h=u.hostname.toLowerCase();if(u.protocol!=="https:"||u.username||u.password||h==="localhost"||h.endsWith(".local")||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)||h.includes(":"))return undefined;return u.toString();}catch{return undefined;}}
export function connectError(error){
 const code=String(error?.message||"CONNECT_OPERATION_FAILED");
 const allowed=new Set(["BACKEND_NOT_CONFIGURED","INVALID_JSON","BODY_TOO_LARGE","AUTH_REQUIRED","INVALID_OR_EXPIRED_SESSION",
 "CONNECT_ACTIVE_MERCHANT_OWNER_REQUIRED","CONNECT_APP_NOT_FOUND","CONNECT_APP_NOT_APPROVED","CONNECT_APP_NOT_PENDING","CONNECT_APP_NOT_SUSPENDED","CONNECT_APP_NOT_ACTIVE","CONNECT_APP_NAME_INVALID",
 "CONNECT_HTTPS_URL_REQUIRED","CONNECT_SECRET_HASH_INVALID","CONNECT_EXTERNAL_REFERENCE_INVALID","CONNECT_CURRENCY_NOT_SUPPORTED","CONNECT_CAPABILITY_DENIED",
 "CONNECT_CHECKOUT_NOT_FOUND","CONNECT_CHECKOUT_NOT_PAYABLE","CONNECT_SETTLEMENT_FAILED","CONNECT_PAYOUT_NOT_FOUND","CONNECT_PAYOUT_FORBIDDEN","CONNECT_PAYOUT_NOT_PENDING","CONNECT_PAYOUT_EXPIRED",
 "CONNECT_PAYOUT_WALLET_UNAVAILABLE","CONNECT_RECIPIENT_REQUIRED","CONNECT_RECIPIENT_NOT_ACTIVE","CONNECT_RECIPIENT_WALLET_NOT_FOUND","CONNECT_REVIEW_DECISION_INVALID","ADMIN_ROLE_REQUIRED",
 "INVALID_AMOUNT","INVALID_IDEMPOTENCY_KEY","IDEMPOTENCY_KEY_REUSED","DESCRIPTION_TOO_LONG","INVALID_EXPIRY","MERCHANT_NOT_ACTIVE","MERCHANT_WALLET_NOT_FOUND",
 "WALLET_NOT_ACTIVE","CURRENCY_MISMATCH","INSUFFICIENT_AVAILABLE_FUNDS","MFA_REQUIRED","ADMIN_PIN_REQUIRED","ADMIN_PERMISSION_DENIED","ACCOUNT_NOT_ACTIVE","ACCOUNT_SUSPENDED"]);
 const status=Number(error?.status)||(code==="BACKEND_NOT_CONFIGURED"?503:400);return json({error:allowed.has(code)?code:"CONNECT_OPERATION_FAILED"},status);
}
