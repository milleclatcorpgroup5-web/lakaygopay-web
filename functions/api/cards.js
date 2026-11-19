import { json, config, requireUser, readJson } from "../_shared/superbase.js";
const FALLBACK_TIERS = [
{tier_code:"BASIC",display_name:"LakayGo Basic",sort_order:1,min_limit_htg:0,max_limit_htg:999999.99,description:"Plafon HTG valide: 0 rive 999,999.99.",benefits:["Kat klas baz","Bous HTG, USD ak EUR"],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true,star_levels:[{star_level:1,star_label:"Basic 1 etwal",min_limit_htg:0,max_limit_htg:333333.33},{star_level:2,star_label:"Basic 2 etwal",min_limit_htg:333333.34,max_limit_htg:666666.66},{star_level:3,star_label:"Basic 3 etwal",min_limit_htg:666666.67,max_limit_htg:999999.99}]},
{tier_code:"STANDARD",display_name:"LakayGo Mwayèn",sort_order:2,min_limit_htg:1000000,max_limit_htg:29999999.99,description:"Plafon HTG valide: 1,000,000 rive 29,999,999.99.",benefits:["Tout avantaj Basic","Avantaj sèvis entèmedyè"],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true,star_levels:[{star_level:1,star_label:"Mwayèn 1 etwal",min_limit_htg:1000000,max_limit_htg:10000000},{star_level:2,star_label:"Mwayèn 2 etwal",min_limit_htg:10000000.01,max_limit_htg:20000000},{star_level:3,star_label:"Mwayèn 3 etwal",min_limit_htg:20000000.01,max_limit_htg:29999999.99}]},
{tier_code:"GOLD",display_name:"LakayGo Gold",sort_order:3,min_limit_htg:30000000,max_limit_htg:100000000,description:"Plafon HTG valide: 30,000,000 rive 100,000,000.",benefits:["Tout avantaj Mwayèn","Avantaj sèvis Gold"],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true,star_levels:[{star_level:1,star_label:"Gold 1 etwal",min_limit_htg:30000000,max_limit_htg:53333333.33},{star_level:2,star_label:"Gold 2 etwal",min_limit_htg:53333333.34,max_limit_htg:76666666.66},{star_level:3,star_label:"Gold 3 etwal",min_limit_htg:76666666.67,max_limit_htg:100000000}]},
{tier_code:"ELITE_GOLD",display_name:"LakayGo Elite Gold",sort_order:4,min_limit_htg:100000000.01,max_limit_htg:null,description:"Plafon HTG valide ki depase 100,000,000.",benefits:["Tout avantaj Gold","Avantaj patnè Elite"],application_open:true,issuance_enabled:false,virtual_supported:true,physical_supported:true,star_levels:[{star_level:1,star_label:"Elite Gold 1 etwal",min_limit_htg:100000000.01,max_limit_htg:250000000},{star_level:2,star_label:"Elite Gold 2 etwal",min_limit_htg:250000000.01,max_limit_htg:500000000},{star_level:3,star_label:"Elite Gold 3 etwal",min_limit_htg:500000000.01,max_limit_htg:null}]}
];
const TIER_SELECT="tier_code,display_name,sort_order,description,benefits,application_open,issuance_enabled,virtual_supported,physical_supported,min_limit_htg,max_limit_htg";
const STAR_SELECT="tier_code,star_level,star_label,min_limit_htg,max_limit_htg";
const LIMIT_SELECT="user_id,approved_limit_htg,limit_currency,tier_code,star_level,assessment_status,reviewed_at,updated_at";
const APPLICATION_SELECT="id,user_id,tier_code,star_level,approved_limit_htg,limit_currency,requested_form,status,created_at,updated_at,reviewed_at";
async function readRows(url,key,resource){
 const res=await fetch(url+"/rest/v1/"+resource,{headers:{apikey:key,authorization:"Bearer "+key,accept:"application/json"}});
 const raw=await res.text();let rows;try{rows=raw?JSON.parse(raw):[];}catch{rows=null;}
 if(!res.ok||!Array.isArray(rows)){const e=new Error("CARD_PROGRAM_DATA_UNAVAILABLE");e.status=res.status===404?503:502;e.schemaMissing=res.status===404;throw e;}return rows;
}
async function existingApplication(url,key,id){
 const rows=await readRows(url,key,"card_applications?select="+encodeURIComponent(APPLICATION_SELECT)+"&user_id=eq."+encodeURIComponent(id)+"&status=in.(waitlist,under_review,eligible)&order=created_at.desc&limit=1");
 return rows[0]||null;
}
async function writeApplication(url,key,payload){
 const res=await fetch(url+"/rest/v1/card_applications?select="+encodeURIComponent(APPLICATION_SELECT),{method:"POST",headers:{apikey:key,authorization:"Bearer "+key,"content-type":"application/json",accept:"application/json",prefer:"return=representation"},body:JSON.stringify(payload)});
 const raw=await res.text();let rows;try{rows=raw?JSON.parse(raw):null;}catch{rows=null;}
 if(!res.ok||!Array.isArray(rows)||!rows[0]){const e=new Error(res.status===409?"CARD_APPLICATION_ALREADY_EXISTS":"CARD_APPLICATION_FAILED");e.conflict=res.status===409;e.schemaMissing=res.status===404;throw e;}
 return rows[0];
}
function attachStars(tiers,stars){
 const map=new Map();for(const star of stars){const group=map.get(star.tier_code)||[];group.push(star);map.set(star.tier_code,group);}
 return tiers.map(tier=>({...tier,star_levels:(map.get(tier.tier_code)||[]).sort((a,b)=>a.star_level-b.star_level)}));
}
export async function onRequestGet({request,env}){
 const auth=await requireUser(request,env);if(auth.error)return auth.error;
 let backend;try{backend=config(env);}catch{return json({error:"BACKEND_NOT_CONFIGURED"},503);}
 try{
  const [tierRows,stars,limits,application]=await Promise.all([
   readRows(backend.url,backend.secretKey,"card_program_tiers?select="+encodeURIComponent(TIER_SELECT)+"&order=sort_order.asc"),
   readRows(backend.url,backend.secretKey,"card_tier_stars?select="+encodeURIComponent(STAR_SELECT)+"&order=tier_code.asc,star_level.asc"),
   readRows(backend.url,backend.secretKey,"card_customer_limits?select="+encodeURIComponent(LIMIT_SELECT)+"&user_id=eq."+encodeURIComponent(auth.user.id)+"&limit=1"),
   existingApplication(backend.url,backend.secretKey,auth.user.id)
  ]);
  const assignment=limits[0]||null;const tiers=attachStars(tierRows,stars);
  const assignedTier=assignment&&assignment.assessment_status==="approved"?tiers.find(t=>t.tier_code===assignment.tier_code)||null:null;
  const assignedStar=assignedTier?assignedTier.star_levels.find(s=>s.star_level===assignment.star_level)||null:null;
  return json({ok:true,schema_ready:true,tiers:tiers.length?tiers:FALLBACK_TIERS,limit_assignment:assignment,assigned_tier:assignedTier,assigned_star:assignedStar,application,card_issuance_enabled:false});
 }catch(error){
  if(error.schemaMissing)return json({ok:true,schema_ready:false,tiers:FALLBACK_TIERS,limit_assignment:null,assigned_tier:null,assigned_star:null,application:null,card_issuance_enabled:false});
  return json({error:"CARD_PROGRAM_DATA_UNAVAILABLE"},503);
 }
}
export async function onRequestPost({request,env}){
 const auth=await requireUser(request,env);if(auth.error)return auth.error;
 let body;try{body=await readJson(request,2000);}catch{return json({error:"INVALID_CARD_APPLICATION"},400);}
 if(Object.prototype.hasOwnProperty.call(body||{},"tier_code")||Object.prototype.hasOwnProperty.call(body||{},"star_level"))return json({error:"CARD_TIER_SERVER_ASSIGNED"},400);
 const form=String(body?.requested_form||"").trim().toLowerCase();
 if(!["virtual","physical","both"].includes(form))return json({error:"CARD_FORMAT_INVALID"},400);
 let backend;try{backend=config(env);}catch{return json({error:"BACKEND_NOT_CONFIGURED"},503);}
 try{
  const limits=await readRows(backend.url,backend.secretKey,"card_customer_limits?select="+encodeURIComponent(LIMIT_SELECT)+"&user_id=eq."+encodeURIComponent(auth.user.id)+"&limit=1");
  const assignment=limits[0];if(!assignment||assignment.assessment_status!=="approved")return json({error:"CARD_LIMIT_NOT_APPROVED"},409);
  const tiers=await readRows(backend.url,backend.secretKey,"card_program_tiers?select="+encodeURIComponent(TIER_SELECT)+"&tier_code=eq."+encodeURIComponent(assignment.tier_code)+"&limit=1");
  const tier=tiers[0];if(!tier)return json({error:"CARD_TIER_INVALID"},409);if(!tier.application_open)return json({error:"CARD_APPLICATION_CLOSED"},409);
  if((form==="virtual"&&!tier.virtual_supported)||(form==="physical"&&!tier.physical_supported)||(form==="both"&&(!tier.virtual_supported||!tier.physical_supported)))return json({error:"CARD_FORMAT_UNAVAILABLE"},400);
  const existing=await existingApplication(backend.url,backend.secretKey,auth.user.id);
  if(existing)return json({ok:true,already_registered:true,application:existing,card_issuance_enabled:false});
  let application;
  try{application=await writeApplication(backend.url,backend.secretKey,{user_id:auth.user.id,tier_code:assignment.tier_code,star_level:assignment.star_level,approved_limit_htg:assignment.approved_limit_htg,limit_currency:"HTG",requested_form:form,status:"waitlist",application_source:"customer_app"});}
  catch(error){if(!error.conflict)throw error;application=await existingApplication(backend.url,backend.secretKey,auth.user.id);if(!application)throw error;return json({ok:true,already_registered:true,application,card_issuance_enabled:false});}
  return json({ok:true,already_registered:false,application,card_issuance_enabled:false},201);
 }catch(error){if(error.schemaMissing)return json({error:"CARD_PROGRAM_SCHEMA_PENDING"},503);return json({error:"CARD_APPLICATION_FAILED"},503);}
}
