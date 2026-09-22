# D205 — teacher profiles and approved timetable

The signed directory projection now creates stable source-owned teacher profiles in setup state. It does not activate accounts, credentials, permissions or invitations. Equal names require explicit identity review; manual profiles and their confirmed assignments remain intact. Departed source-owned setup profiles archive only while they have no credentials or central login binding.

School 1–11 may additionally receive the exact approved Лист2 timetable effective 2026-09-01, source SHA-256 815f52472d71c71a616e42b1f070a63a84bf1efa621f807d1b43dcbdb6f9d02a. It contains 184 weekly academic slots for grades 1–6. First import requires an empty timetable, journal and curriculum sessions; a source ledger and the atomic directory transaction prevent duplicates and partial writes. Only unique confirmed assignments to confirmed setup/active profiles populate lesson teachers. Ambiguous assignments and simultaneous teacher conflicts remain unassigned with reasons. Subsequent delivery preserves manual lesson edits. No attendance, grades or completed lessons are inferred.

Atlas rejects this timetable; its own subject timetable still needs a verified source. No database schema change. Biology is retained in the School catalog. Current teacher cards hide archived profiles and display unresolved appointments explicitly.

Local receiver verification: 13 SQLite behavioral tests, including preview immutability, replay, foreign-school rejection, full rollback, concurrent journal writes, name non-merging, pending credentials and double booking. Receiver source is built and exercised by the central release matrix before production delivery.
