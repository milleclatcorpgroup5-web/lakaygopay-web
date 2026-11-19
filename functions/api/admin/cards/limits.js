import { json, config, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
async function readRows(url,key,resource){
 const res=await fetch(url+"/rest/v1/"+resource,{headers:{apikey:key,authorization:"Bearer "+key,accept:"application/json"}});
 const raw=await res.text();let rows;try{rows=raw?JSON.parse(raw):[];}catch{rows=null;}
 if(!res.ok||!Array.isArray(rows)){const e=new Error("CARD_LIMIT_ASSIGNMENTS_UNAVAILABLE");e.schemaMissing=res.status===404;throw e;}return rows;
}
export async function onRequestGet({request,env}){
 const access=await requireAdminRoles(request,env,["risk_admin"]);if(access.error)return access.error;
 try{
  const {url,secretKey}=config(env);
  const rows=await readRows(url,secretKey,"card_customer_limits?select=user_id,approved_limit_htg,limit_currency,tier_code,star_level,assessment_status,reviewed_by,reviewed_at,updated_at&order=updated_at.desc&limit=100");
  const ids=rows.map(r=>r.user_id).filter(Boolean);let profiles=[];
  if(ids.length)profiles=await readRows(url,secretKey,"profiles?select=id,full_name,account_status&id=in.("+ids.map(encodeURIComponent).join(",")+")");
  const map=new Map(profiles.map(p=>[p.id,p]));
  return json({ok:true,assignments:rows.map(r=>({...r,full_name:map.get(r.user_id)?.full_name||null,account_status:map.get(r.user_id)?.account_status||null})),generated_at:new Date().toISOString()});
 }catch(e){return json({error:e?.schemaMissing?"CARD_LIMIT_SCHEMA_NOT_READY":"CARD_LIMIT_ASSIGNMENTS_UNAVAILABLE"},503);}
}
export async function onRequestPost({request,env}){
 const access=await requireAdminRoles(request,env,["risk_admin"]);if(access.error)return access.error;
 try{
  const body=await readJson(request,3000);const userId=String(body?.target_user_id||"").trim();const amount=String(body?.approved_limit_htg??"").trim();const reason=String(body?.reason||"").trim();
  if(!validUuid(userId))return json({error:"INVALID_USER_ID"},400);
  if(!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(amount))return json({error:"CARD_LIMIT_INVALID"},400);
  if(reason.length<10||reason.length>300)return json({error:"CARD_LIMIT_REASON_INVALID"},400);
  const assignment=await callRpc(env,"admin_set_card_limit",{p_admin_user_id:access.user.id,p_target_user_id:userId,p_approved_limit_htg:amount,p_reason:reason});
  return json({ok:true,assignment});
 }catch(error){
  const allowed=new Set(["CARD_LIMIT_INVALID","CARD_LIMIT_REASON_INVALID","CARD_LIMIT_USER_REQUIRED","CARD_CUSTOMER_NOT_ACTIVE","CARD_LIMIT_CLASSIFICATION_FAILED","ADMIN_PERMISSION_DENIED"]);
  const code=allowed.has(error?.message)?error.message:"CARD_LIMIT_UPDATE_FAILED";
  const status=code==="ADMIN_PERMISSION_DENIED"?403:code==="CARD_CUSTOMER_NOT_ACTIVE"?404:error?.status===503?503:400;
  return json({error:code},status);
 }
}
