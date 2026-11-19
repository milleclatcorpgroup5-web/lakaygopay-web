import { json,callRpc,validUuid,validAmount,idempotencyKey } from "../../../_shared/superbase.js";
import { authenticatePartner,connectError,validConnectReference } from "../../../_shared/connect.js";
export async function onRequestPost({request,env}){try{const a=await authenticatePartner(request,env);if(a.error)return a.error;const {app,body}=a;
 if(!Array.isArray(app.capabilities)||!app.capabilities.includes("payout"))return json({error:"CONNECT_CAPABILITY_DENIED"},403);
 const key=idempotencyKey(request);if(!key)return json({error:"IDEMPOTENCY_KEY_REQUIRED"},400);
 if(!validConnectReference(body.external_reference))return json({error:"CONNECT_EXTERNAL_REFERENCE_INVALID"},400);
 if(!validUuid(body.recipient_user_id))return json({error:"CONNECT_RECIPIENT_REQUIRED"},400);
 const amount=validAmount(body.amount);if(!amount)return json({error:"INVALID_AMOUNT"},400);
 const currency=String(body.currency||"HTG").toUpperCase();if(!["HTG","USD","EUR"].includes(currency))return json({error:"CONNECT_CURRENCY_NOT_SUPPORTED"},400);
 if(body.description!=null&&(typeof body.description!=="string"||body.description.length>140))return json({error:"DESCRIPTION_TOO_LONG"},400);
 const payout=await callRpc(env,"connect_create_payout_request",{p_app_id:app.id,p_external_reference:body.external_reference.trim(),p_idempotency_key:key,p_recipient_user_id:body.recipient_user_id,p_amount:amount,p_currency:currency,p_description:body.description||null});
 return json({ok:true,mode:"sandbox",payout},201);
 }catch(e){return connectError(e);}}
export async function onRequestGet({request,env}){try{const a=await authenticatePartner(request,env);if(a.error)return a.error;const ref=new URL(request.url).searchParams.get("external_reference");if(!validConnectReference(ref))return json({error:"CONNECT_EXTERNAL_REFERENCE_INVALID"},400);const payout=await callRpc(env,"connect_partner_payout_status",{p_app_id:a.app.id,p_external_reference:ref});return json({ok:true,mode:"sandbox",payout});}catch(e){return connectError(e);}}
