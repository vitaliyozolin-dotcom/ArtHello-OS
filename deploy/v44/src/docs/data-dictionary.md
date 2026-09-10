# Словарь данных

Каждая доменная запись обязана иметь: `id`, `status`, `created_at`, `updated_at`, `created_by`, `source_system`, `source_record_id`, `import_batch_id`, `data_quality_status`.

Чувствительность: `public`, `internal`, `personal`, `child_sensitive`, `medical_restricted`, `financial_restricted`. Доступ определяется ролью, юрлицом, объектом и подразделением.

Текущие D1-таблицы:

- `tasks`: задача/поручение, источник, единая карточка ответственного, срок, приоритет, последовательный статус, родитель, повтор, результат и признак согласования;
- `task_watchers`: наблюдатель из единого справочника или системная роль;
- `task_checklist`: пункт, признак выполнения и времена создания/изменения;
- `task_comments`: неизменяемый рабочий комментарий;
- `task_approvals`: шаг согласования, статус, автор решения, комментарий и время;
- `workflow_documents`: стабильный ID, тип, текущая версия, статус, срок и владелец;
- `document_versions`: номер версии, описание изменения, ссылка/основание и автор;
- `task_documents`: связь задачи с документом;
- `obligations`: документ, обязательство, срок, владелец, статус и горизонт предупреждения;
- `notifications`: получатель, тип, текст, источник, статус прочтения и дедупликационный ключ;
- `escalations`: задача, уровень, причина, статус и получатель;
- `entities`: устойчивый ID, тип, название, источник, качество и область использования;
- `entity_links`: исходная карточка, связанная карточка, тип связи, автор и время;
- `entity_documents`: номер/название, тип, статус, срок и источник метаданных документа;
- `entity_merges`: основная карточка, ID дубля, причина, автор и время;
- `financial_operations`: денежная операция в копейках, измерения, документ и происхождение;
- `finance_accruals`, `finance_budgets`, `finance_forecast_items`, `finance_payroll_summary`: агрегаты начислений, планы, прогноз и обезличенная зарплата;
- `finance_corrections`, `finance_reconciliation_issues`: append-only корректировки и контролируемые расхождения;
- `sales_leads`: first-click атрибуция, UTM, кампания, креатив, оффер, форма, менеджер, этап, статус и метки;
- `sales_touchpoints`: тип контакта, канал, направление, краткое содержание, итог и ссылка на источник;
- `sales_stage_events`: переход этапа, исход, доказательство, автор и время;
- `client_accruals`: семья, ребёнок, договор, услуга, период, сумма, срок, статус и финансовая операция;
- `client_lifecycles`: LTV, срок жизни, прогноз платежа, риск и его факторы, лояльность и повторный оффер;
- `client_bonuses`: неизменяемое начисление или списание баллов;
- `marketing_accounts`: платформа, тестовый аккаунт, статус, аудитория и тип источника;
- `content_plan_items`: дата, канал, автор, формат, тема, оффер, кампания, бриф и статус;
- `content_publications`: публикация и метрики от охвата до выручки;
- `content_attributions`: публикация, клик, лид, договор, платёж и модель атрибуции;
- `content_recommendations`: сигнал, доказательство, рекомендация, статус и связанная задача;
- `education_programs`: программа, версия, статус, автор, методист, область, материал и ожидаемый результат;
- `education_groups`: класс или дополнительная группа, подразделение, программа, назначенный педагог, кабинет и статус;
- `education_students`: обезличенные ребёнок, семья, группа, состояние кабинета и обучения;
- `education_lessons`: дата, тема, педагог, замена, кабинет, статус и домашнее задание;
- `education_attendance`: уникальная пара занятие–ученик, статус, оценка, результат и автор записи;
- `education_progress`: период, метрика, балл, тренд и доказательство;
- `education_feedback`: семья, ребёнок, программа, рейтинг, комментарий, рекомендация и методическая задача;
- `education_communications`: новость, событие или чат, область аудитории и автор;
- `hr_vacancies`: вакансия, подразделение, должность, число ставок, статус и тип источника;
- `hr_candidates`: единая карточка, вакансия, источник, этап, оценка, решение, отсев, оффер и доказательство;
- `hr_interviews`: кандидат, время, интервьюер, балл, итог и решение;
- `hr_employees`: договор, должность, ставка в копейках, подразделение, даты найма/увольнения, причина и статус доступов;
- `hr_onboarding`: сотрудник, шаг, срок, статус, доказательство и задача;
- `hr_development`: обучение, аттестация, оценка, лояльность или резерв, балл и доказательство;
- `hr_rewards`: премия, депремирование или нарушение, сумма, основание, период и статус;
- `hr_accesses`: система, роль, выдача, отзыв и документированная причина;
- `legal_contracts`: сторона, тип договора, номер, подпись, период, лимит/расход в копейках, реквизиты, ЭП, владелец и закрытие;
- `legal_document_items`: стабильный ID, договор, тип документа, версия, обязательность, подпись, статус, срок и ссылка;
- `legal_responsibility_zones`: договор, зона, ответственная карточка, область и статус;
- `legal_checks`: договор или отсутствующий договор, тип сигнала, тяжесть, доказательство, рекомендация, задача и решение;
- `procurement_suppliers`: поставщик, специализация, договор, базовая цена, качество, рейтинг, индекс рынка и качество данных;
- `purchase_requests`: заявитель, подразделение, предмет, количество, бюджет, срок, статус, обоснование и согласующий;
- `supplier_offers`: заявка, поставщик, цена, срок, гарантия, качество, статус и объяснение сравнения;
- `purchase_orders`, `procurement_deliveries`: выбранное предложение, заказ, сумма, сроки, поставка, документ и результат приёмки;
- `inventory_items`, `inventory_events`: номенклатура, склад, остаток, стоимость и неизменяемое движение;
- `assets`, `asset_maintenance`: имущество, серийный номер, объект, ответственный, гарантия, сервис, ремонт, стоимость и амортизация;
- `acceptance_decisions`: этап, вердикт, комментарий, автор и время;
- `audit_events`: неизменяемое событие действия.

## Этап 11 — питание

- `food_products`: `supplier_id`, `unit`, `purchase_cost_minor`, `storage_norm`, `status`;
- `food_batches`: `product_id`, `purchase_request_id`, `received_at`, `expires_at`, `quantity`, `remaining_quantity`, `warehouse`, `quality_note`;
- `food_recipes`: `dish_name`, `version`, `yield_portions`, `standard_cost_minor`, `norm_description`, `menu_date`, `status`;
- `food_recipe_ingredients`: `recipe_id`, `product_id`, `quantity_per_batch`, `unit`, `cost_minor`;
- `food_production`: `production_date`, `recipe_id`, `shift_id`, `planned_portions`, `actual_portions`, `material_cost_minor`, `evidence`;
- `food_shipments`: `production_id`, `destination_object_id`, `shipped_portions`, `consumed_portions`, `returned_portions`, `written_off_portions`, `revenue_minor`, `document_id`;
- `food_shifts`: `employee_entity_id`, `started_at`, `ended_at`, `rate_minor`, `role`, `status`;
- `food_checks`: `check_type`, `object_entity_id`, `checked_at`, `result`, `violation`, `evidence`, `related_task_id`.

Все денежные поля хранятся в копейках. Остаток отгрузки равен `shipped - consumed - returned - written_off`; прибыль — `revenue - material - labor`.

## Этап 12 — безопасность

- `safety_systems`: `system_type`, `object_entity_id`, `scheme_ref`, `journal_ref`, `responsible_entity_id`, `status`, `source_type`;
- `safety_equipment`: `system_id`, `inventory_number`, `location`, `contractor_id`, `criticality`, `next_check_at`, `status`;
- `safety_checks`: `equipment_id`, `object_entity_id`, `check_type`, `scheduled_at`, `checked_at`, `result`, `evidence`, `responsible_entity_id`;
- `safety_faults`: `check_id`, `equipment_id`, `severity`, `description`, `detected_at`, `status`, `related_task_id`;
- `safety_incidents`: `object_entity_id`, `system_id`, `happened_at`, `category`, `severity`, `description`, `response`, `status`;
- `safety_repairs`: `fault_id`, `contractor_id`, `action_type`, `completed_at`, `result`, `act_document_id`, `cost_minor`, `payment_operation_id`;
- `safety_next_checks`: `equipment_id`, `source_repair_id`, `scheduled_at`, `check_type`, `responsible_entity_id`;
- `safety_guard_shifts`: `object_entity_id`, `employee_entity_id`, `post`, `started_at`, `ended_at`, `journal_ref`, `status`.

## Этап 13 — медицинское сопровождение

- `medical_access_grants`: `principal_type`, `principal_ref`, `scope`, `granted_by`, `valid_until`, `status`;
- `medical_documents`: `subject_entity_id`, `subject_type`, `document_type`, `document_ref`, `valid_from`, `valid_until`, `storage_class`, `minimum_summary`, `confirmed_at`;
- `medical_restrictions`: `subject_entity_id`, `record_id`, `category`, `limitation`, `valid_until`, `action_scope`, `status`;
- `medical_cases`: `subject_entity_id`, `case_type`, `opened_at`, `severity`, `minimum_summary`, `responsible_entity_id`, `due_at`, `closed_at`, `confirmation_ref`;
- `medical_incidents`: `case_id`, `happened_at`, `incident_type`, `minimum_facts`, `response_required`, `status`;
- `medical_actions`: `case_id`, `incident_id`, `action_type`, `responsible_entity_id`, `due_at`, `completed_at`, `result`, `confirmation_ref`, `status`.

`document_ref` содержит только синтетическую защищённую ссылку, не файл. `minimum_summary` и `action_scope` служат минимизации раскрытия и не передают диагноз.

## Этап 14 — бухгалтерия и первичные документы

- `accounting_documents`: `document_type`, `number`, `document_date`, `counterparty_entity_id`, `contract_id`, `amount_minor`, `vat_minor`, `payment_operation_id`, `file_ref`, `signature_status`, `edo_status`, `source_type`, `status`;
- `accounting_document_links`: `from_document_id`, `to_document_id`, `relation_type`, `evidence`;
- `accounting_completeness_checks`: `operation_id`, `contract_id`, JSON-массивы `required_types`/`missing_types`, `owner_entity_id`, `related_task_id`, `checked_at`;
- `accounting_exports`: `export_type`, `period`, `document_count`, `amount_minor`, `status`, `file_ref`, `created_by`, `created_at`;
- `accounting_integrations`: `system`, `mode`, `status`, `truth`, `last_success_at`, `next_attempt_at`, `record_count`, `error`.

Деньги хранятся в копейках. `file_ref` — синтетическая ссылка без файлового содержимого; `status=Подготовлен` не означает передачу в 1С.

## Этап 15 — стратегия, проекты и события

- `strategy_goals`: `level`, `unit_entity_id`, `title`, `period`, `owner_entity_id`, `status`, `success_definition`;
- `strategy_kpis`: `goal_id`, `name`, `unit`, `target_value`, `actual_value`, `forecast_value`, `variance_value`, `status`, `source_ref`, `updated_at`;
- `strategy_initiatives`: `goal_id`, `kpi_id`, `title`, `hypothesis`, `owner_entity_id`, `planned_start`, `planned_end`, `status`;
- `strategy_projects`: `initiative_id`, `goal_id`, `title`, `owner_entity_id`, `budget_id`, `budget_plan_minor`, `budget_actual_minor`, `started_at`, `due_at`, `status`, `outcome`;
- `business_events`: `project_id`, `title`, `event_at`, `location`, `responsible_entity_id`, `budget_minor`, `actual_minor`, `status`, `result`, `feedback_score`;
- `event_participants`: `event_id`, `participant_entity_id`, `participant_role`, `attendance_status`, `feedback`;
- `strategy_results`: `project_id`, `event_id`, `result_type`, `metric_name`, `metric_value`, `unit`, `evidence`, `recorded_at`;
- `strategy_deviations`: `kpi_id`, `project_id`, `deviation_type`, `variance_value`, `explanation`, `decision`, `status`, `related_task_id`, `detected_at`.

Деньги проектов и событий хранятся в копейках; значения KPI — числа в собственной единице измерения. `source_ref` и `evidence` обязательны для доказуемости результата.

## Этап 16 — Центр интеграций

- `integration_connections`: `system`, `category`, `target_module`, `owner_entity_id`, `source_of_truth`, `mode`, `status`, `auth_status`, `credential_expires_at`, `last_success_at`, `next_sync_at`, пять счётчиков, `impact`, `adapter_version`, `verified_transfer`, `is_enabled`;
- `integration_sync_runs`: `connection_id`, `started_at`, `finished_at`, `trigger`, `status`, пять счётчиков, `checkpoint`, `error_message`, `initiated_by`, `correlation_id`, `dry_run`;
- `integration_log_entries`: `run_id`, `connection_id`, `level`, `event`, `message`, `record_ref`, `created_at`;
- `integration_conflicts`: `connection_id`, `external_record_id`, `internal_entity_id`, `conflict_type`, `field_name`, `source_value`, `target_value`, `owner_entity_id`, `status`, `resolution`, `evidence`, `related_task_id`, `detected_at`, `resolved_at`.

Токены, пароли и содержимое ключей отсутствуют принципиально. `credential_expires_at` хранит только срок; `record_ref` проходит минимизацию и не должен содержать персональные данные.

## Этап 17 — аналитика и AI governance

- `analytics_metric_definitions`: `definition`, `formula`, `unit`, `grain`, `source_tables`, `source_quality`, `freshness`, `owner_entity_id`, `target_value`, `sensitive`;
- `analytics_signals`: `contract_id`, `domain`, `signal_type`, `severity`, `evidence`, `explanation`, `recommendation`, `source_refs`, `confidence`, `related_task_id`, `human_decision`, `decision_evidence`;
- `ai_process_contracts`: все поля обязательного AI-контракта, `status`, `version`, `source_refs`, `updated_at`;
- `ai_model_runs`: `model_version`, `input_snapshot_ref`, `output_type`, `output_summary`, `confidence`, `cost_minor`, `explanation`, human decision fields, `is_synthetic`;
- `ai_opt_outs`: `scope_type`, `scope_ref`, `requested_by`, `reason`, `status`, `stops_processing_at`, `historical_data_policy`.

`confidence` хранится в процентных пунктах 0–100. `cost_minor` — копейки; у внутреннего test rule engine стоимость внешней модели равна нулю.
