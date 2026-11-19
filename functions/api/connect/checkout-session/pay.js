import { json,requireUser,callRpc,readJson,validUuid,idempotencyKey } from "../../../_shared/superbase.js";
import { assertTransactionPin } from "../../../_shared/pin.js";
import { connectError } from "../../../_shared/connect.js";
export async function onRequestPost({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const b=await readJson(request);
 if(!validUuid(b?.checkout_id)||!validUuid(b?.payer_wallet_id))return json({error:"CONNECT_CHECKOUT_NOT_FOUND"},400);
 const key=idempotencyKey(request);if(!key)return json({error:"IDEMPOTENCY_KEY_REQUIRED"},400);
 await assertTransactionPin(env,a.user.id,b?.pin);
 const payment=await callRpc(env,"connect_pay_checkout_session",{p_actor_user_id:a.user.id,p_checkout_id:b.checkout_id,p_payer_wallet_id:b.payer_wallet_id,p_idempotency_key:key});
 return json({ok:true,payment});
 }catch(e){return connectError(e);}}
