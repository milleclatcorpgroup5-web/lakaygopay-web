import { json,requireUser,callRpc,readJson,validUuid,idempotencyKey } from "../../../_shared/superbase.js";
import { assertTransactionPin } from "../../../_shared/pin.js";
import { connectError } from "../../../_shared/connect.js";
export async function onRequestPost({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const b=await readJson(request);if(!validUuid(b?.payout_id))return json({error:"CONNECT_PAYOUT_NOT_FOUND"},400);
 const key=idempotencyKey(request);if(!key)return json({error:"IDEMPOTENCY_KEY_REQUIRED"},400);await assertTransactionPin(env,a.user.id,b?.pin);
 const payout=await callRpc(env,"connect_accept_payout",{p_actor_user_id:a.user.id,p_payout_id:b.payout_id,p_idempotency_key:key});return json({ok:true,payout});
 }catch(e){return connectError(e);}}
