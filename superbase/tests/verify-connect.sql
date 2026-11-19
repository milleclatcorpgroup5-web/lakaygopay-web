-- Read-only verification for LakayGoPay Connect.
select 'connect_apps' item,to_regclass('public.connect_apps') is not null exists;
select 'connect_checkout_sessions' item,to_regclass('public.connect_checkout_sessions') is not null exists;
select 'connect_payout_requests' item,to_regclass('public.connect_payout_requests') is not null exists;
select c.relname table_name,c.relrowsecurity rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('connect_apps','connect_checkout_sessions','connect_payout_requests') order by c.relname;
select status,mode,count(*) app_count from public.connect_apps group by status,mode order by status;
select count(*) filter(where status='pending') pending_checkouts,count(*) filter(where status='paid') paid_checkouts,
 count(*) filter(where status='expired') expired_checkouts from public.connect_checkout_sessions;
select count(*) filter(where status='pending') pending_payouts,count(*) filter(where status='accepted') accepted_payouts,
 count(*) filter(where status='expired') expired_payouts from public.connect_payout_requests;
select count(*) invalid_non_sandbox_apps from public.connect_apps where mode<>'sandbox';
select p.proname function_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'connect_%' order by p.proname;
