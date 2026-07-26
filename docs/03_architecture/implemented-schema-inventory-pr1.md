---
project_id: ARTHELLO
document_type: implemented_schema_inventory
status: partial
lifecycle_state: active
owner_role: TECH_OWNER_ROLE
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-26
source: github_pr_1_head_75fa619906e2c7df5a53d618a0e6d2af827ad1ef
---

# Реализованная схема данных в PR №1

Это машинно сверенный снимок объявлений `pgTable` в рабочей ветке
`codex/a3-live-read-only` на коммите
`75fa619906e2c7df5a53d618a0e6d2af827ad1ef`.

Снимок фиксирует код, а не готовность production-базы:

- PR открыт, является черновиком и не влит в `main`;
- production-gate закрыт;
- миграции не применялись к production;
- общий вердикт независимой проверки — `FAIL`;
- логическая Company OS Entity Model шире и не равна этой физической схеме;
- наличие таблицы не подтверждает полноту данных, бизнес-правил или интерфейса.

## Сводка

- Файлов схемы с объявлениями `pgTable`: 24.
- Физических таблиц, объявленных в коде: 114.
- Таблиц из файлов, экспортируемых через `schema/index.ts`: 112.
- `conversations` и `messages` обнаружены в отдельных файлах, но на момент
  снимка не экспортируются через общий `schema/index.ts`.
- `alfa-provenance.ts` содержит проверки происхождения данных, но не объявляет
  отдельную таблицу.

## Таблицы по модулям

| Файл | Объявленные таблицы |
|---|---|
| `alpha-sync.ts` | `alpha_sync_batches`, `alpha_raw_records`, `alpha_raw_observations`, `alpha_sync_scope_runs`, `alpha_endpoint_registry`, `alpha_linking_issues`, `alpha_verification_reports`, `alpha_sync_scope`, `alpha_duplicate_candidates` |
| `banking.ts` | `bank_connectors`, `bank_accounts`, `bank_sync_runs`, `bank_transactions_raw`, `bank_statements` |
| `connectors.ts` | `source_connectors`, `raw_events`, `normalized_events`, `bank_import_batches`, `integration_credentials` |
| `contractors.ts` | `contractors`, `contractor_accruals`, `contractor_payments`, `contractor_documents` |
| `contracts.ts` | `contracts` |
| `conversations.ts` | `conversations` |
| `counterparties.ts` | `counterparties`, `bank_transaction_counterparty_links`, `counterparty_aliases`, `counterparty_duplicate_candidates` |
| `crm.ts` | `crm_branches`, `crm_students`, `crm_payments`, `crm_lessons`, `crm_attendance`, `crm_teachers`, `lead_events`, `marketing_leads`, `marketing_sources`, `settings`, `sync_logs`, `crm_groups`, `crm_student_identities` |
| `documents.ts` | `documents` |
| `educational.ts` | `directions`, `programs`, `class_groups`, `schedule_assignments`, `enrollments`, `educational_units`, `person_roles` |
| `employees.ts` | `departments`, `employees`, `employee_roles`, `payroll_rules`, `employee_educational_unit_links` |
| `evotor.ts` | `evotor_connectors`, `evotor_sync_batches`, `evotor_raw_records` |
| `finance.ts` | `bank_transactions`, `dds_categories`, `opiu_categories`, `categorization_rules`, `manual_adjustments`, `payroll_accruals`, `contracts_obligations`, `opiu_monthly`, `dds_monthly`, `recurring_obligations` |
| `ledger.ts` | `articles`, `operations`, `operation_history` |
| `master-data.ts` | `legal_entities`, `operating_unit_legal_entity`, `branch_legal_entity_assignments`, `source_import_batches`, `source_raw_records`, `crm_group_memberships`, `crm_leads`, `crm_customer_tariffs`, `crm_reference_records`, `crm_change_log`, `family_merge_candidates`, `employee_external_identities`, `payroll_periods`, `salary_accruals`, `payroll_payments` |
| `messages.ts` | `messages` |
| `month-closings.ts` | `month_closings` |
| `payables.ts` | `payable_obligations`, `obligation_documents`, `incoming_email_documents` |
| `persons.ts` | `persons`, `person_contacts`, `person_links`, `identity_match_queue`, `families`, `student_profiles`, `guardian_student_links` |
| `reconciliation.ts` | `bank_alpha_reconciliation_runs`, `bank_alpha_reconciliation_matches` |
| `security.ts` | `auth_sessions`, `security_access_audit`, `auth_login_attempts` |
| `staff.ts` | `staff_rates`, `staff_payouts`, `staff_profiles`, `staff_bonuses`, `staff_vacations`, `staff_deductions` |
| `taxes.ts` | `tax_obligations`, `tax_reserve` |
| `timeline.ts` | `timeline_events`, `family_health`, `health_alerts` |

## Как использовать этот документ

1. Для проектирования новых функций использовать
   [Company OS Entity Model](company-os-entity-model-v1.md) как логический
   стандарт.
2. Для оценки текущей реализации использовать этот снимок и исходный код PR.
3. Перед миграцией или интеграцией повторно сверять схему по точному коммиту.
4. Не считать таблицы с финансовыми, кадровыми или семейными данными
   разрешением на их публикацию в Git.
5. После изменения схемы создавать новую версию снимка, не переписывая
   исторический факт.

## Открытые риски реализации

До нового формального технического gate остаются открытыми:

- разрушимость raw provenance через `TRUNCATE` и неполная нормализованная
  lineage;
- необратимость миграции 0014 в цикле apply → rollback → reapply;
- неполное каскадирование stale-состояния ученика и риск восстановления
  дочерних записей;
- конфликт документации webhook с реализованными требованиями auth/CSRF.

Подробности зафиксированы в
[известных блокерах](../08_qa_tests/known-blockers.md) и точных
эксплуатационных снимках PR №1.
