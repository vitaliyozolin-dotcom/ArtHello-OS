# Каталог доменных событий

- `lead.created`, `lead.source_missing`, `lead.converted`;
- `family.created`, `child.enrolled`, `contract.signed`, `contract.expiring`;
- `charge.created`, `payment.received`, `bank_operation.matched`, `reconciliation.conflict`;
- `employee.hired`, `employee.access_granted`, `employee.terminated`, `employee.access_revoked`;
- `lesson.completed`, `attendance.recorded`, `homework.assigned`;
- `equipment.checked`, `fault.detected`, `repair.completed`;
- `task.created`, `task.completed`, `acceptance.recorded`.
- `entity.created`, `entity.updated`, `entity.relation_added`, `entity.document_linked`, `entity.merge_survivor`, `entity.merged`.
- `task.auto_created`, `task.status_changed`, `task.checklist_added`, `task.checklist_changed`, `task.watcher_added`, `task.comment_added`, `task.approval_decided`, `task.document_linked`, `task.recurrence_created`;
- `document.created`, `document.version_added`, `obligation.expiring`, `notification.read`, `escalation.opened`.
- `sales.stage_advanced`, `sales.touchpoint_logged`, `sales.lead_rejected`, `sales.followup_task_created`;
- `finance.correction_proposed`, `finance.issue_task_created`, `finance.issue_resolved`.
- `content.plan_created`, `content.published`, `content.recommendation_task_created`.
- `education.attendance_recorded`, `education.program_version_created`, `education.feedback_task_created`, `education.message_sent`.
- `hr.candidate_advanced`, `hr.interview_recorded`, `hr.onboarding_task_created`, `hr.personnel_event_recorded`, `hr.employee_terminated`, `hr.access_revoked`.
- `legal.document_added`, `legal.document_version_added`, `legal.signal_detected`, `legal.signal_task_created`, `legal.signal_resolved`.
- `procurement.request_created`, `procurement.request_approved`, `procurement.offer_selected`, `procurement.order_created`, `procurement.delivery_accepted`, `inventory.received`, `inventory.issued`, `inventory.moved`, `inventory.written_off`, `asset.maintenance_task_created`.
- `food.recipe_version_created`, `food.production_created`, `food.consumption_recorded`, `food.batch_written_off`, `food.check_task_created`.
- `safety.check_scheduled`, `safety.fault_detected`, `safety.fault_task_created`, `safety.incident_recorded`, `safety.repair_completed`, `safety.next_check_scheduled`.
- `medical.records_viewed`, `medical.access_denied`, `medical.action_denied`, `medical.document_confirmed`, `medical.action_completed`, `medical.case_closed`.
- `accounting.document_created`, `accounting.payment_linked`, `accounting.missing_task_created`, `accounting.signature_confirmed`, `accounting.export_prepared`.
- `strategy.event_created`, `strategy.event_result_recorded`, `strategy.kpi_actual_updated`, `strategy.corrective_task_created`, `strategy.deviation_closed`.
- `integration.sync_succeeded`, `integration.retry_blocked`, `integration.paused`, `integration.resumed`, `integration.conflict_task_created`, `integration.conflict_resolved`.
- `analytics.scenario_run`, `analytics.signal_task_created`, `analytics.human_decision_recorded`, `analytics.opt_out_recorded`, `analytics.contract_restored`.

Критичные события должны записываться в рамках той же операции или через транзакционный outbox после подключения полной доменной БД.
