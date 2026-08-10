# Company OS Core v2

This directory is the machine-readable governance layer for Company OS processes.

## Mandatory execution path

1. Source-of-Truth Controller verifies decision-critical data.
2. AI Contract Gate validates the AI Process Contract before production execution.
3. Experiment Operator is required for new ideas and major product/process changes before full build.
4. Revenue Recovery Agent may act only on verified commercial data and must produce a concrete next action.
5. SOP Compiler reviews accepted repeatable work and stores reusable knowledge.

## AI Process Contract

Every AI process must declare:

- input data;
- expected result;
- allowed actions;
- forbidden actions;
- human responsible;
- maximum cost per run;
- benefit metric;
- automatic shutdown condition;
- whether a user can opt out, how they opt out, what functions remain, what data processing stops, how previous data is handled, and service impact.

A process without a valid contract is `blocked` and cannot run in production.

## Safety and authority

Autonomous actions are not permitted for money transfers, contract signatures, legal commitments, deletion of customer data, or other irreversible external actions. These require explicit human approval.

Financial actions are blocked when source data is stale, conflicted, or unverified.

## Experiment decisions

Every experiment ends with exactly one explicit decision:

- `KILL` — stop and do not continue spending;
- `ITERATE` — change the hypothesis/test and run a new bounded experiment;
- `SCALE` — proceed only when the predefined success metric has been achieved.

## SOP rule

Closing a task is not enough. If an accepted result is repeatable, the system must evaluate it for conversion into an SOP, checklist, template, prompt, or reusable module. Before similar work starts later, the SOP library is searched first.

## Runtime integration contract

An orchestrator integrating this specification should expose these gates/events:

- `data.verify(metric)` -> trust status and canonical value;
- `aiContract.validate(processId)` -> blocked/test_only/approved/paused/killed;
- `experiment.evaluate(workItem)` -> KILL/ITERATE/SCALE;
- `revenueRecovery.scan(scope)` -> prioritized recovery queue;
- `sopCompiler.capture(acceptedWork)` -> reusable artifact or no-op with reason.

The canonical process definitions are stored in `core-v2.json`; contract validation is defined by `ai-process-contract.schema.json`.
