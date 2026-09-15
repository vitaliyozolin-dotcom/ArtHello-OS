# Alfa server audit — completed read-only runs

Runtime run 35013864337, job 104532255454: OS, Atlas and School 1–11 health endpoints all returned HTTP 200 from arthello-gateway. Caddy and the active OS container were running. Browser 502 did not demonstrate a production outage.

Source run 35014168259 and group run 35014398866 completed successfully using the existing Alfa credential inside the OS container. No business data, access, application runtime or bank integration was changed. Logs contain aggregates and allowlisted classroom labels, never customer names, phone numbers or credentials.

Five mapped source branches: 6, 10, 9, 8, 2. There is an additional accessible, unmapped branch 5; its 10 included records must not enter this migration automatically. Across mapped branches, current snapshot includes 807 clients/leads and 175 active source statuses. One status is unknown. These are customers, not confirmed unique families, and are not fixed import targets.

Atlas source branch 6 contains school groups 1050, 1051, 1052 and 1053, respectively 1–4 classes in 2026–2027. Included group memberships are 6, 10, 9 and 7, not proof of 32 active pupils. Source branch 10 is empty. User-approved routing requires retaining source IDs while projecting those school groups into BR-ATLAS-SCHOOL. Other branch 6 records remain subject to their actual group/status evidence.

Current OS family counts: School 1–11 68, Atlas kindergarten 137, Atlas school 893, Nebo 894, Listvennaya 894 active cards plus 1 review card. These are incorrect historical projections, not a current active-family count.

The temporary read-only workflow was removed after its evidence was captured, preserving the repository's reviewed maximum of 16 active workflows. Its script and versioned workflow history remain available. No workflow count ratchet or production capability gate was weakened.

Outstanding: deploy candidate status/routing code through a reviewed release, apply a complete comparison preserving manual archives and historical references, resolve unknown source status without guessing, and transfer confirmed school directories separately from access grants. No production reconciliation has been applied by these diagnostic runs.
