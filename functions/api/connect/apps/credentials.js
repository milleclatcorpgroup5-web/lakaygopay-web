import { json,requireUser,callRpc,readJson,validUuid } from "../../../_shared/superbase.js";
import { connectError,sha256Hex } from "../../../_shared/connect.js";
function b64url(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
export async function onRequestPost({request,env}){try{const a=await requireUser(request,env);if(a.error)return a.error;const b=await readJson(request);if(!validUuid(b?.app_id))return json({error:"CONNECT_APP_NOT_FOUND"},400);
 const secret="lgp_test_secret_"+b64url(crypto.getRandomValues(new Uint8Array(40)));const hash=await sha256Hex(secret);
 const result=await callRpc(env,"connect_issue_credentials",{p_owner_user_id:a.user.id,p_app_id:b.app_id,p_secret_hash:hash});
 return json({ok:true,credentials:{client_id:result.client_id,client_secret:secret,mode:"sandbox",shown_once:true}},201);
 }catch(e){return connectError(e);}}
