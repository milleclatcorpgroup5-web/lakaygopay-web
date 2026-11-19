import { json,requireUser,callRpc,validUuid } from "../../_shared/superbase.js";
import { connectError } from "../../_shared/connect.js";
export async function onRequestGet({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const id=new URL(request.url).searchParams.get("id");if(!validUuid(id))return json({error:"CONNECT_CHECKOUT_NOT_FOUND"},400);const checkout=await callRpc(env,"connect_get_checkout_for_customer",{p_actor_user_id:a.user.id,p_checkout_id:id});return json({ok:true,checkout});}catch(e){return connectError(e);}}
