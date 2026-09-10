# D101: correct the R15 publication method

Status: draft; no production or bank acceptance.

Actual protected R15 run34443217193 attempt1 / deploy102762766189 completed failure on 2026-09-10T06:00:42Z. Accepted R13 history passed. The next provenance step stopped before checkout, imports, snapshot, cutover or authentication. Both cleanup steps passed.

Fresh GitHub commit evidence for bd3553187c6adcda3e0be1586b25c9c3b61dc3de shows a valid verified signature and two parents: 9862a6e863d4d791c00ddeaba9480154ad5b8c4d and 2b8a72941c938df33cda9d5d697c272f92e663e4. The unchanged controller requires exactly one parent equal to PREVIOUS_RELEASE_SHA. Codex used merge_method=merge for PR404, which is incompatible with that gate. The prior release audit missed this publication-method requirement; the gate itself must remain unchanged.

Prepare a fresh reviewed source/PR identity from current main, retain the failed source/run in history, and publish only with merge_method=squash. Verify the resulting GitHub commit signature, sole expected parent and exact reviewed tree immediately after merge. Do not rerun the incompatible old commit, rewrite main history, or relax the one-parent/signature gate. Existing main CI and a new protected run remain mandatory. All bank, School, backup, snapshot, auth and publication boundaries remain unchanged.
