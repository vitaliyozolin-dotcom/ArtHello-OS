import fs from "node:fs";

function stripFromMarker(source, marker) {
  const index = source.indexOf(marker);
  return index === -1 ? source : source.slice(0, index).trimEnd() + "\n";
}

const polishPath = "/app/app/components/SystemWideMobilePolish.css";
let polish = fs.readFileSync(polishPath, "utf8");
for (const marker of [
  "/* ARTHELLO_MOBILE_VISUAL_HELP_FOLLOWUP */",
  "/* ARTHELLO_OPERATIONAL_UX_V3 */",
  "/* ARTHELLO_MOBILE_DESIGN_SYSTEM_V4 */",
]) {
  polish = stripFromMarker(polish, marker);
}

polish += `
/* ARTHELLO_MOBILE_CANONICAL_V5 */
:root {
  --ah-mobile-gutter: 20px;
  --ah-mobile-gap: 16px;
  --ah-mobile-card-radius: 22px;
  --ah-mobile-control-radius: 16px;
  --ah-mobile-control-height: 48px;
}

@media (max-width: 720px) {
  .page {
    padding-left: var(--ah-mobile-gutter) !important;
    padding-right: var(--ah-mobile-gutter) !important;
  }

  /* One geometry system for operational modules. */
  .safety-workspace :is(.safety-kpis > *, .operational-empty-card, .operational-inline-empty, .safety-panel),
  .proc-workspace :is(.proc-kpis > *, .operational-empty-card, .operational-inline-empty, .proc-panel),
  .food-workspace :is(.food-kpis > *, .operational-empty-card, .operational-inline-empty, .food-panel),
  .medical-workspace :is(.medical-kpis > *, .operational-empty-card, .operational-inline-empty, .medical-panel),
  .strategy-workspace :is(.strategy-kpis > *, .operational-empty-card, .operational-inline-empty, .strategy-panel),
  .accounting-workspace :is(.accounting-panel, .accounting-start-panel) {
    border-radius: var(--ah-mobile-card-radius) !important;
  }

  .safety-workspace .safety-boundary,
  .proc-workspace .proc-boundary,
  .food-workspace .food-boundary,
  .medical-workspace .medical-boundary,
  .strategy-workspace .strategy-boundary,
  .accounting-workspace .accounting-boundary {
    border-radius: var(--ah-mobile-control-radius) !important;
  }

  /* Contractors: exactly one empty card. Never style text descendants as cards. */
  .contractor-workspace {
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
  }

  .contractor-workspace > .page {
    padding-left: var(--ah-mobile-gutter) !important;
    padding-right: var(--ah-mobile-gutter) !important;
  }

  .contractor-workspace .operational-inline-empty,
  .contractor-workspace .manual-module-empty {
    width: 100% !important;
    max-width: 100% !important;
    padding: 22px !important;
    border: 1px solid var(--ah-system-line) !important;
    border-radius: var(--ah-mobile-card-radius) !important;
    background: #fff !important;
    box-shadow: 0 10px 32px rgba(38, 43, 71, 0.045) !important;
    overflow: hidden !important;
  }

  .contractor-workspace .operational-inline-empty > :is(strong, p, span, small),
  .contractor-workspace .manual-module-empty > :is(h2, h3, strong, p, span, small) {
    width: auto !important;
    max-width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  .contractor-workspace .operational-inline-empty > button,
  .contractor-workspace .manual-module-empty > button {
    border-radius: var(--ah-mobile-control-radius) !important;
  }

  /* Dashboard KPI cards: fixed icon column + text column; no edge-clinging labels. */
  [data-help-block="kpis"] > button {
    display: grid !important;
    grid-template-columns: 42px minmax(0, 1fr) !important;
    align-items: center !important;
    column-gap: 14px !important;
    min-width: 0 !important;
    padding: 18px !important;
    border-radius: var(--ah-mobile-card-radius) !important;
    text-align: left !important;
  }

  [data-help-block="kpis"] > button > span:first-child {
    width: 42px !important;
    min-width: 42px !important;
    height: 42px !important;
    margin: 0 !important;
  }

  [data-help-block="kpis"] > button > span:last-child {
    display: grid !important;
    min-width: 0 !important;
    gap: 3px !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  [data-help-block="kpis"] > button > span:last-child :is(small, strong, em) {
    max-width: 100% !important;
    margin: 0 !important;
    white-space: normal !important;
    overflow-wrap: normal !important;
    word-break: normal !important;
  }

  /* Finance period is a compact filter, not a second dashboard card. */
  .finance-period-bar {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 10px !important;
    margin: 14px 0 16px !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  .finance-period-bar > div:first-child {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 10px !important;
    min-width: 0 !important;
  }

  .finance-period-bar > div:first-child > span {
    color: var(--ah-system-muted) !important;
    font-size: 14px !important;
    font-weight: 650 !important;
  }

  .finance-period-bar > div:first-child > strong,
  .finance-period-bar > div:first-child > small {
    display: none !important;
  }

  .finance-period-actions {
    display: grid !important;
    grid-template-columns: var(--ah-mobile-control-height) minmax(0, 1fr) var(--ah-mobile-control-height) auto !important;
    align-items: center !important;
    gap: 8px !important;
    width: 100% !important;
  }

  .finance-period-actions > button:not(.finance-current-period),
  .finance-period-actions input,
  .finance-period-actions .finance-current-period {
    height: var(--ah-mobile-control-height) !important;
    min-height: var(--ah-mobile-control-height) !important;
    border-radius: var(--ah-mobile-control-radius) !important;
  }

  .finance-period-actions > button:not(.finance-current-period) {
    width: var(--ah-mobile-control-height) !important;
    min-width: var(--ah-mobile-control-height) !important;
    padding: 0 !important;
  }

  .finance-period-actions label {
    min-width: 0 !important;
  }

  .finance-period-actions input {
    width: 100% !important;
    min-width: 0 !important;
    padding: 0 12px !important;
    text-align: center !important;
    font-size: 16px !important;
  }

  .finance-period-actions .finance-current-period {
    width: auto !important;
    min-width: 0 !important;
    padding: 0 14px !important;
    white-space: nowrap !important;
    font-size: 14px !important;
  }

  @media (max-width: 420px) {
    .finance-period-actions {
      grid-template-columns: var(--ah-mobile-control-height) minmax(0, 1fr) var(--ah-mobile-control-height) !important;
    }
    .finance-period-actions .finance-current-period {
      grid-column: 1 / -1 !important;
      width: 100% !important;
    }
  }
}
`;

fs.writeFileSync(polishPath, polish, "utf8");

const helpPath = "/app/app/components/ContextualHelpSystem.css";
let help = fs.readFileSync(helpPath, "utf8");
for (const marker of [
  "/* ARTHELLO_HELP_UX_V3 */",
  "/* ARTHELLO_HELP_VISIBILITY_V4 */",
]) {
  help = stripFromMarker(help, marker);
}
help += `
/* ARTHELLO_HELP_CANONICAL_V5 */
[data-ah-help-target="true"] { position: relative !important; overflow: visible !important; }
[data-ah-help-target="true"] > button[data-ah-help-inline="true"].ah-field-icon {
  position: absolute !important;
  left: auto !important;
  right: 12px !important;
  top: 50% !important;
  bottom: auto !important;
  transform: translateY(-50%) !important;
  width: 24px !important;
  min-width: 24px !important;
  height: 24px !important;
  margin: 0 !important;
  z-index: 40 !important;
  opacity: .95 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}
[data-ah-help-target="true"] > :is(input:not([type="checkbox"]):not([type="radio"]), select, textarea, [role="combobox"]) {
  padding-right: 48px !important;
}
@media (max-width: 720px) {
  .ah-tour-callout {
    position: fixed !important;
    left: 12px !important;
    right: 12px !important;
    top: auto !important;
    bottom: calc(96px + env(safe-area-inset-bottom)) !important;
    width: auto !important;
    max-width: none !important;
    max-height: min(56dvh, 520px) !important;
    transform: none !important;
    overflow: auto !important;
  }
  .ah-tour-hole { border-radius: 18px !important; pointer-events: none !important; }
  .ah-tour-blocker { touch-action: none; }
}
`;
fs.writeFileSync(helpPath, help, "utf8");

console.log("patch-mobile-canonical-v5: layered mobile CSS removed; canonical system applied");
