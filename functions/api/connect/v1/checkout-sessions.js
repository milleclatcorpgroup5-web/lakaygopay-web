import { json,callRpc,validAmount,idempotencyKey } from "../../../../_shared/superbase.js";
import { authenticatePartner,connectError,validConnectReference,validHttpsUrl } from "../../../../_shared/connect.js";
export async function onRequestPost({request,env}){try{const a=await authenticatePartner(request,env);if(a.error)return a.error;const {app,body}=a;
 if(!Array.isArray(app.capabilities)||!app.capabilities.includes("checkout"))return json({error:"CONNECT_CAPABILITY_DENIED"},403);
 const key=idempotencyKey(request);if(!key)return json({error:"IDEMPOTENCY_KEY_REQUIRED"},400);
 if(!validConnectReference(body.external_reference))return json({error:"CONNECT_EXTERNAL_REFERENCE_INVALID"},400);
 const amount=validAmount(body.amount);if(!amount)return json({error:"INVALID_AMOUNT"},400);
 const currency=String(body.currency||"HTG").toUpperCase();if(!["HTG","USD","EUR"].includes(currency))return json({error:"CONNECT_CURRENCY_NOT_SUPPORTED"},400);
 if(body.description!=null&&(typeof body.description!=="string"||body.description.length>140))return json({error:"DESCRIPTION_TOO_LONG"},400);
 const successUrl=validHttpsUrl(body.success_url);if(body.success_url&&!successUrl)return json({error:"CONNECT_HTTPS_URL_REQUIRED"},400);
 const expires=Number(body.expires_in_minutes??15);if(!Number.isInteger(expires)||expires<1||expires>60)return json({error:"INVALID_EXPIRY"},400);
 const s=await callRpc(env,"connect_create_checkout_session",{p_app_id:app.id,p_external_reference:body.external_reference.trim(),p_idempotency_key:key,p_amount:amount,p_currency:currency,p_description:body.description||null,p_success_url:successUrl,p_expires_in_minutes:expires});
 return json({ok:true,mode:"sandbox",checkout:{id:s.checkout_id,external_reference:s.external_reference,amount:s.amount,currency:s.currency,status:s.status,expires_at:s.expires_at,checkout_url:new URL("/connect/checkout/?session="+encodeURIComponent(s.checkout_id),request.url).toString()}},201);
 }catch(e){return connectError(e);}}
