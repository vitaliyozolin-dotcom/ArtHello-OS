# ArtHello Front Office — Internal Alpha

Status: implemented, disabled in production by default  
Project boundary: `ARTHELLO` only  
Autonomy: `DRAFT_ONLY`  
Data boundary: synthetic records only  
External channels: disabled  
Outbound delivery: not implemented

## What this milestone adds

The internal alpha turns the approved static Front Office preview into a
durable, testable sales workflow inside ArtHello OS.

It supports:

- a persistent conversation and lead record;
- a controlled sales funnel;
- an owner, next action and deadline;
- internal notes and AI drafts;
- tasks and completion tracking;
- optimistic concurrency;
- an append-only audit trail;
- idempotent synthetic seed data;
- manual creation of synthetic leads.

It does not support:

- real channel ingress;
- outbound customer messages;
- live AlfaCRM reads or writes;
- financial, contractual or booking actions;
- real family data;
- automatic merging;
- autonomous stage changes.

## Database model

Migration: `lib/db/drizzle/0016_uneven_the_santerians.sql`

Tables:

- `front_office_conversations`;
- `front_office_messages`;
- `front_office_leads`;
- `front_office_tasks`;
- `front_office_audit_events`.

Every conversation is constrained to `project_id = 'ARTHELLO'`.

The audit table is protected against update, delete and truncate operations by
database triggers. The rollback is stored in
`lib/db/rollbacks/0016_front_office_internal_alpha.down.sql`.

## Funnel state machine

```text
NEW
  → QUALIFIED
  → PROGRAM_MATCHED
  → TRIAL_REQUESTED
  → TRIAL_CONFIRMED
  → WON
```

Every active stage may also move to `LOST`. Terminal records cannot be reopened
in this milestone.

An active lead must have:

- an owner;
- a next action;
- a next-action deadline.

A lost lead must have a loss reason.

## API surface

Read:

- `GET /api/front-office/health`;
- `GET /api/front-office/workspace`.

Synthetic writes:

- `POST /api/front-office/demo/seed`;
- `POST /api/front-office/leads`;
- `PATCH /api/front-office/leads/:id`;
- `POST /api/front-office/conversations/:id/notes`;
- `PATCH /api/front-office/tasks/:id`.

There is intentionally no send, delivery or outbound endpoint.

All mutable existing records are checked with `is_synthetic = true`.
Production requires an explicit
`FRONT_OFFICE_INTERNAL_ALPHA_ENABLED=true` setting.

## User interface

The module is mounted in the owner navigation:

```text
Продажи и сервис → Front Office → Рабочий стол
```

The working desktop can:

- initialize the synthetic workspace;
- show funnel metrics;
- filter leads by stage;
- open a lead and its conversation;
- update the stage and next action;
- create a task by changing the next action;
- save an internal note or AI draft;
- complete a task;
- display relevant audit history;
- create a new synthetic lead.

The older Inbox, Knowledge and Control Center views remain read-only previews
until their persistent workflows are implemented separately.

## Activation gate

Before any real ingress:

1. assign operational roles;
2. approve business hours and SLA;
3. approve identity verification;
4. approve source-of-truth records for prices, programs and schedule;
5. run the test catalog;
6. pass independent QA;
7. enable one channel in `SHADOW`, without AI sending.
