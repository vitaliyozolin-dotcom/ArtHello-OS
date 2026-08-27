# ArtHello OS — Design System migration plan

Status: foundation only. No production workspace may import this layer until the baseline and rollback prerequisites are complete.

## Safety gates

1. Git checkpoint: `checkpoint/pre-design-system-2026-08-27`.
2. Production database backup must exist before the first workspace migration deployment.
3. Baseline screenshots must be captured before the first workspace migration.
4. Existing patch chain stays untouched during foundation work.
5. One workspace is migrated per PR.
6. Any unrelated visual diff blocks merge.
7. Old CSS/patch layers are removed only after all migrated workspaces no longer depend on them.

## Migration order

1. ContractorWorkspace — pilot.
2. Safety / operational security workspace.
3. Clients & Families.
4. Finance.
5. Owner Dashboard.
6. Remaining operational modules.
7. Education last among mature screens; it is the current mobile visual reference.

## Required shared primitives

- PageContainer
- PageHeader
- Card
- KpiCard
- EmptyState
- SearchField
- Tabs
- PeriodSelector
- Modal / BottomSheet
- HelpMarker
- GuidedTour

## Acceptance rule

A workspace is considered migrated only if:

- it uses shared design tokens and primitives instead of workspace-specific visual copies;
- 375×812, 390×844, 430×932, 768×1024, 1440×900 and 2560×1440 have been visually checked;
- there is no page-level horizontal overflow;
- text is not clipped or hidden behind controls;
- interactive targets match visible controls;
- current data, permissions and API behavior are unchanged;
- unrelated workspaces have no visual regression.

## Prohibited migration shortcuts

- appending another global mobile CSS layer;
- `[class*=card]`, `[class*=panel]`, `[class*=empty]` selectors;
- blanket `!important` rules;
- changing several workspaces in one migration PR;
- deleting legacy patches before migrated screens stop depending on them;
- accepting unit/build tests as visual approval.
