import { json,requireUser,callRpc } from "../../_shared/superbase.js";
import { connectError } from "../../_shared/connect.js";
export async function onRequestGet({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const data=await callRpc(env,"connect_list_my_payouts",{p_actor_user_id:a.user.id});return json({ok:true,payouts:data?.payouts||[]});}catch(e){return connectError(e);}}
