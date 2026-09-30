# ArtHello OS — Visual baseline manifest

Baseline commit: `1aa562c534871a13685a019a67bca2e1cbbedf31`
Checkpoint branch: `checkpoint/pre-design-system-2026-08-27`

This manifest defines the mandatory baseline to capture before the first Design System workspace migration reaches production.

## Viewports

- 375×812 — compact iPhone
- 390×844 — standard iPhone
- 430×932 — large iPhone
- 768×1024 — tablet
- 1440×900 — laptop
- 2560×1440 — 27-inch desktop reference

## Mandatory routes / states

- Home / Owner dashboard
- Finance: Register
- Finance: Cashflow
- Finance: P&L
- Finance: Plan & forecast
- Clients & Families: empty/default state
- Contractors: empty/default state
- Safety: default state
- Education: default state — mobile visual reference
- Access: default state — desktop typography reference
- Sales: pipeline
- Integrations
- Content
- Documents / Legal
- Analytics
- HR / Team

## For every capture verify

- page gutter;
- card radius and inner padding;
- no clipped text;
- no horizontal page overflow;
- tabs keep active item visible;
- fixed navigation does not cover content;
- help marker does not cover content;
- empty-state layout;
- search icon and help-marker alignment;
- modal/bottom-sheet safe areas where applicable.

## Diff policy

During a single-workspace migration, only the target workspace and intentionally shared primitives may change. Any visual change in an unrelated route is a regression until explicitly approved.

## Data rule

Baseline screenshots are evidence of layout only. Production data must not be copied into repository fixtures or screenshot artifacts if it contains personal or confidential information.
