import { json,callRpc } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
import { serviceRest,connectError } from "../../../_shared/connect.js";
export async function onRequestGet({request,env}){try{const a=await requireAdminRoles(request,env,["risk_admin","finance_admin"]);if(a.error)return a.error;
 const apps=await serviceRest(env,"connect_apps?select=id,owner_user_id,merchant_id,app_name,website_url,status,mode,capabilities,review_note,reviewed_at,created_at,merchants(business_name)&order=created_at.desc&limit=100");
 return json({ok:true,apps:apps||[]});}catch(e){return connectError(e);}}
export async function onRequestPost({request,env}){try{const a=await requireAdminRoles(request,env,["risk_admin","finance_admin"]);if(a.error)return a.error;const b=await request.json().catch(()=>null);
 if(!b||typeof b!=="object"||!b.app_id)return json({error:"CONNECT_APP_NOT_FOUND"},400);
 const result=await callRpc(env,"connect_review_application",{p_admin_user_id:a.user.id,p_app_id:b.app_id,p_decision:b.decision,p_note:typeof b.note==="string"?b.note.slice(0,500):null});
 return json({ok:true,application:result});}catch(e){return connectError(e);}}
