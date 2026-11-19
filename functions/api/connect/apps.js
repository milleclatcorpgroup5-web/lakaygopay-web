import { json,requireUser,callUserRest,callRpc,readJson,validUuid } from "../../_shared/superbase.js";
import { connectError } from "../../_shared/connect.js";
export async function onRequestGet({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const apps=await callUserRest(env,a.accessToken,"connect_apps?select=id,app_name,merchant_id,website_url,status,mode,capabilities,client_id,review_note,reviewed_at,created_at,updated_at&order=created_at.desc&limit=50");return json({ok:true,apps:apps||[]});}catch(e){return connectError(e);}}
export async function onRequestPost({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const b=await readJson(request);if(!validUuid(b?.merchant_id))return json({error:"CONNECT_ACTIVE_MERCHANT_OWNER_REQUIRED"},400);
 if(typeof b?.app_name!=="string"||b.app_name.trim().length<2||b.app_name.trim().length>100)return json({error:"CONNECT_APP_NAME_INVALID"},400);
 const website=typeof b.website_url==="string"?b.website_url.trim():"";if(!/^https:\/\/[^/]+/i.test(website)||website.length>500)return json({error:"CONNECT_HTTPS_URL_REQUIRED"},400);
 const application=await callRpc(env,"connect_create_application",{p_owner_user_id:a.user.id,p_merchant_id:b.merchant_id,p_app_name:b.app_name.trim(),p_website_url:website});
 return json({ok:true,application},201);
 }catch(e){return connectError(e);}}
