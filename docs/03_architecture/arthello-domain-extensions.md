---
project_id: ARTHELLO
document_type: domain_model
status: review
lifecycle_state: active
owner_role: DATA_OWNER
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-26
source: master_plan_and_front_office_review
---

# Отраслевые расширения ArtHello

## Идентичность и семья

- `Prospect`
- `ContactPoint`
- `Family`
- `FamilyMembership`
- `RepresentativeRole`
- `PayerRole`
- `ChildPickupAuthorization`
- `IdentityVerification`
- `ConsentPreference`
- `ExternalIdentity`
- `SourceRecordLink`
- `MergeCandidate`

Родитель, законный представитель, плательщик и получающий ребёнка — разные роли.

## Образовательный read-model

- `Student`
- `Branch`
- `Program`
- `Group`
- `Class`
- `Lesson`
- `ScheduleSlot`
- `Attendance`
- `Teacher`
- `Subscription`
- `Tariff`
- `CRMCharge`
- `CRMResponsible`

Первичный источник этих объектов определяется [картой источников истины](../04_data_integrations/source-of-truth-map.md).

## Продажи

- `Lead`
- `Opportunity`
- `Pipeline`
- `PipelineStage`
- `StageTransition`
- `QualificationSnapshot`
- `ProductInterest`
- `ProgramCandidate`
- `TrialRequest`
- `TrialStateEvent`
- `NextAction`
- `LossReason`

## Маркетинг

- `Campaign`
- `MarketingTouchpoint`
- `AttributionSnapshot`
- `AcquisitionCost`

## Клиентский сервис

- `Conversation`
- `Message`
- `ServiceTicket`
- `TicketEvent`
- `Priority`
- `SLAClock`
- `Assignment`
- `Handoff`
- `Resolution`
- `FollowUp`

## Знания и AI

- `KnowledgeArticle`
- `KnowledgeVersion`
- `KnowledgeApproval`
- `VerifiedFact`
- `SourceReference`
- `KnowledgeScope`
- `KnowledgeGap`
- `RetrievalRun`
- `AIDraft`
- `ClaimEvidence`
- `HumanReview`
- `QAEvaluation`
- `PolicyDecision`
- `ActionProposal`
- `AutomationRun`

## Интеграции и аудит

- `SyncCursor`
- `SyncEvent`
- `SourceConflict`
- `Incident`
- `IdempotencyKey`
- `TransactionalOutboxItem`

## Финансы и персонал

- `Employee`
- `EmploymentRelationship`
- `PayrollRule`
- `SalaryAccrual`
- `TaxAccrual`
- `Payout`
- `BankAccount`
- `BankStatement`
- `BankTransaction`
- `MatchingStatus`
- `ReconciliationItem`
- `Budget`
- `CashFlowItem`
- `ProfitAndLossItem`
- `FinancialForecast`

Названия являются логической моделью до code/schema audit. Перед созданием таблиц они сопоставляются с уже существующей схемой, чтобы не создать дубль.

