import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
const $=s=>document.querySelector(s);const checkoutId=new URLSearchParams(location.search).get("session");let supabase=null,checkout=null;
function notice(t,k=""){const n=$("#notice");n.textContent=t;n.className="checkout-status"+(k?" "+k:"");}
async function sessionNow(){const r=await supabase.auth.getSession();if(r.error)throw r.error;return r.data.session;}
async function api(path,session,body){const r=await fetch(path,{method:body?"POST":"GET",headers:{accept:"application/json",authorization:"Bearer "+session.access_token,...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"REQUEST_FAILED");return d;}
function format(v,c){return Number(v).toLocaleString("fr-HT",{minimumFractionDigits:2,maximumFractionDigits:2})+" "+c;}
async function loadCheckout(session){const d=await api("/api/connect/checkout-session?id="+encodeURIComponent(checkoutId),session);checkout=d.checkout;
 $("#merchantName").textContent=checkout.merchant_name||checkout.app_name||"Machann LakayGoPay";$("#amount").textContent=format(checkout.amount,checkout.currency);$("#description").textContent=checkout.description||"Peman atravè LakayGoPay Connect";
 if(checkout.status!=="pending"){notice("Estati demann sa a: "+checkout.status+". Li pa kapab peye ankò.",checkout.status==="paid"?"success":"error");$("#payForm").hidden=true;return;}
 const w=await api("/api/wallets",session);const choices=(w.wallets||[]).filter(x=>x.currency===checkout.currency&&!x.is_system&&x.status==="active");$("#wallet").replaceChildren();
 choices.forEach(x=>{const o=document.createElement("option");o.value=x.wallet_id;o.textContent=x.currency+" · "+Number(x.balance||0).toLocaleString("fr-HT",{minimumFractionDigits:2,maximumFractionDigits:2})+" disponib";$("#wallet").append(o);});
 if(!choices.length){notice("Ou pa gen bous aktif nan "+checkout.currency+" pou peye demann sa a.","error");$("#payButton").disabled=true;}
 $("#checkoutLogin").hidden=true;$("#checkoutDetails").hidden=false;notice("Verifye detay yo. Peman an ap fèt sèlman apre ou antre PIN ou epi konfime.","");
}
async function boot(){if(!checkoutId){notice("Lyen peman an pa gen yon referans sesyon valab.","error");return;}const c=await fetch("/api/config",{cache:"no-store"});const cfg=await c.json().catch(()=>({}));
 if(!c.ok||!cfg.configured||!cfg.supabaseUrl||!cfg.publishableKey){notice("Sèvis koneksyon an pa disponib.","error");return;}
 supabase=createClient(cfg.supabaseUrl,cfg.publishableKey,{auth:{storage:localStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const s=await sessionNow();if(s){$("#checkoutLogin").hidden=true;try{await loadCheckout(s);}catch(e){notice("Nou pa kapab chaje demann lan: "+e.message,"error");}}
 $("#loginForm").addEventListener("submit",async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const r=await supabase.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});if(r.error)throw r.error;$("#password").value="";await loadCheckout(r.data.session);}catch{notice("Koneksyon an echwe. Verifye kont ou oswa retounen sou LakayGoPay.","error");}finally{b.disabled=false;}});
 $("#payForm").addEventListener("submit",async e=>{e.preventDefault();const pin=$("#pin").value;if(!/^[0-9]{4}$/.test(pin)){notice("Antre PIN tranzaksyon 4 chif ou.","error");return;}if(!confirm("Ou konfime peman "+format(checkout.amount,checkout.currency)+" bay "+checkout.merchant_name+"?"))return;
 const b=$("#payButton");b.disabled=true;notice("Ap verifye PIN ou epi anrejistre peman an…");try{const ss=await sessionNow();const r=await fetch("/api/connect/checkout-session/pay",{method:"POST",headers:{accept:"application/json","content-type":"application/json",authorization:"Bearer "+ss.access_token,"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({checkout_id:checkoutId,payer_wallet_id:$("#wallet").value,pin}),cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"PAYMENT_FAILED");$("#pin").value="";notice("Peman konfime. Referans: "+(d.payment.reference||d.payment.ledger_transaction_id||"OK"),"success");$("#payForm").hidden=true;
 if(checkout.success_url){const u=new URL(checkout.success_url);if(u.protocol==="https:"){u.searchParams.set("lgp_payment","success");u.searchParams.set("lgp_reference",checkoutId);const a=document.createElement("a");a.href=u.toString();a.textContent="Retounen nan aplikasyon an";a.className="checkout-button";a.style.display="block";a.style.textAlign="center";a.style.textDecoration="none";$("#checkoutDetails").append(a);}}
 }catch(err){notice("Peman an pa fèt: "+err.message,"error");}finally{b.disabled=false;$("#pin").value="";}});
}
boot().catch(()=>notice("Sistèm peman an pa kapab kòmanse.","error"));
