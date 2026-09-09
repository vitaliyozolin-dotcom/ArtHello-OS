# D095 — Four-digit task labels

One shared formatter line changes taskRecordLabel from direct recordSequence interpolation to existing recordLabel("Задача", value). Queue, board, drawer, subtasks, notifications, history, source references, global search results and palette already call it. Values1 and801 display as Задача №0001 and Задача №0801. Storage IDs, routes and links remain raw and unchanged.

Accepted source77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed and inspected mainb4c39d5af8ab348882759c48c0f82dbe810a8065 have the same formatter base blob64218eaac10dec8237b5ad9d6b923de868e1ff37. Proposed formatter5171cb1127d6e43cda596047eae6c19098b4af1b, tests cd4b9bd062d6351343ee40f97421c9416e9fdd4b. Real formatter RED2failed/2passed before, GREEN4passed after; independent reviewer reproduced4passes and confirmed reverse-delta/base and actual callers. Full exact-source CI and future browser evidence are pending. No current production change.

This implements display padding only. Existing recordSequence modulo10000 may produce colliding labels; search still uses raw IDs and may not match a padded label query. No claim of globally sequential unique numbers or search correction. The old accepted R12 scoped adapter's №801 assertion and source pin remain untouched; future padded visual proof must reference the newly accepted application artifact.
