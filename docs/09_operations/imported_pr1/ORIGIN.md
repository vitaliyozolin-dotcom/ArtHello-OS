---
project_id: ARTHELLO
document_type: source_manifest
status: partial
lifecycle_state: active
owner_role: TECH_OWNER
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-05
source: github_pr_1_codex_a3_live_read_only
---

# Эксплуатационные документы из PR №1

Этот каталог содержит снимки документации из ветки `codex/a3-live-read-only`:

- `BACKLOG.md`;
- `CURRENT_STATE.md`;
- `DATA_COVERAGE.md`;
- `DECISIONS.md`;
- `MASTER_BOOK.md`;
- `MONTH_CLOSE_CHECKLIST.md`;
- `RUNBOOK.md`;
- `SECURITY_CHECKLIST.md`;
- `integration_contracts.md`;
- `replit.md`.

Снимки нужны, чтобы библиотека могла быть проверена независимо от незамёрженного кода.

Ограничения:

- исходная ветка остаётся главным источником для текущего технического состояния;
- перенос не означает approval;
- документы содержат исторические checkpoint и должны читаться вместе с `known-blockers.md`;
- после merge PR №1 дубли должны быть заменены ссылками либо архивированы отдельным решением.

