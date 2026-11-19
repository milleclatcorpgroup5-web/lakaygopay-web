# LakayGo Card — plafon, klasman ak etwal otomatik

## Règ pwodwi a
Kliyan an pa chwazi klasman kat li. LakayGo bay klasman an otomatikman dapre **plafon finansye HTG ki fin evalye, verifye epi apwouve** sou kont kliyan an. Se pa balans aktyèl bous la, epi se pa yon montan kliyan an antre pou kont li.

| Klasman | Plafon HTG | Etwal |
| --- | ---: | --- |
| LakayGo Basic | 0 rive 999,999.99 HTG | 1★ / 2★ / 3★ |
| LakayGo Mwayèn | 1,000,000 rive 29,999,999.99 HTG | 1★ / 2★ / 3★ |
| LakayGo Gold | 30,000,000 rive 100,000,000 HTG | 1★ / 2★ / 3★ |
| LakayGo Elite Gold | Plis pase 100,000,000 HTG | 1★ / 2★ / 3★ |

Limit yo pa sipèpoze: 1,000,000 antre nan Mwayèn; 30,000,000 antre nan Gold; 100,000,000 rete Gold; 100,000,000.01 antre nan Elite Gold.

## Pwopozisyon nivo etwal yo
- Basic: 1★ 0–333,333.33; 2★ 333,333.34–666,666.66; 3★ 666,666.67–999,999.99 HTG.
- Mwayèn: 1★ 1–10 milyon; 2★ 10,000,000.01–20 milyon; 3★ 20,000,000.01–29,999,999.99 HTG.
- Gold: 1★ 30–53,333,333.33; 2★ 53,333,333.34–76,666,666.66; 3★ 76,666,666.67–100 milyon HTG.
- Elite Gold: 1★ 100,000,000.01–250 milyon; 2★ 250,000,000.01–500 milyon; 3★ plis pase 500 milyon HTG.

Etwal yo se nivo andedan menm klasman an. Valè sa yo se premye pwopozisyon; ekip risk la ka ajiste ranje yo apre apwobasyon.

## Workflow ak kontwòl
1. Kliyan an ouvri yon kont nòmal.
2. Ekip Risk verifye idantite, dokiman, sous fon ak baz pou fikse plafon an.
3. Super Admin oswa Risk Admin, apre PIN Admin ak MFA/AAL2, antre plafon HTG ki apwouve a nan modil Kat LakayGo.
4. PostgreSQL detèmine klasman ak etwal la; valè tier kliyan an ta voye pa janm sèvi kòm otorite.
5. Aplikasyon kliyan an montre klasman ki asiyen an epi li pèmèt demann enterè pou kat vityèl/fizik.
6. Chak chanjman plafon ekri nan card_limit_history, yon journal append-only.
7. Emisyon kat rete OFF. Pa gen PAN, CVV, PIN kat oswa OTP ki estoke.

## Limit deviz
Premye vèsyon an sèvi ak plafon HTG sèlman. Pa konpare montan HTG, USD ak EUR dirèkteman. Pa fè konvèsyon pou klase kliyan jiskaske sous FX verifye, politik evalyasyon ak patnè finansye apwouve.

## Modèl ak sekirite
- card_customer_limits: plafon otorize ak klasman/etwal ki sòti nan bazdone.
- card_tier_stars: ranje pou 1, 2 ak 3 etwal.
- card_limit_history: journal chanjman append-only.
- card_applications: snapshot plafon, klasman, etwal ak fòm kat kliyan an mande.
- /api/admin/cards/limits: Super Admin / Risk Admin sèlman, avèk PIN Admin, MFA AAL2 ak verifikasyon wòl sou sèvè.
- /api/cards: kliyan ka li sèlman pwòp klasman pa yo; yo pa ka pase tier_code oswa star_level nan demann.

## Migrasyon ak verifikasyon
1. Verifye migrasyon 202611180004_lakaygo_card_program_foundation.sql aplike anvan.
2. Revize epi aplike 202611190001_lakaygo_card_limits_and_stars.sql nan pwojè Supabase ki kòrèk la.
3. Egzekite superbase/tests/verify-card-program.sql.
4. Teste GET /api/cards ak yon kont ki poko gen plafon.
5. Teste limit 0, 999,999.99, 1,000,000, 30,000,000, 100,000,000, 100,000,000.01 ak 500,000,000.01 HTG.
6. Verifye kliyan an pa kapab soumèt klasman oswa etwal pa li.
7. Verifye Risk Admin/Super Admin sèlman kapab chanje plafon epi chak chanjman rete nan audit.

Migrasyon SQL la nan GitHub sèlman; li pa egzekite otomatikman sou Supabase Production. Emisyon kat ak peman sou rezo kat yo rete OFF.
