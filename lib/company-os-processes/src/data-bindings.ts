import type { ProcessId } from "./types";

export type DataSourceKind =
  | "postgres"
  | "api-route"
  | "external-api"
  | "web-research"
  | "github-ci"
  | "project-registry";

export type BindingStatus = "active" | "partial" | "blocked";

export interface DataSourceBinding {
  id: string;
  kind: DataSourceKind;
  system: string;
  sourceOfTruth: boolean;
  readOnly: boolean;
  location: string;
  purpose: string;
  freshnessCheck?: string;
  required: boolean;
}

export interface ProcessDataBinding {
  processId: ProcessId;
  status: BindingStatus;
  sources: DataSourceBinding[];
  blockers: string[];
  runPolicy: "allow" | "allow-with-warning" | "deny";
}

const arthelloPostgres = (id: string, location: string, purpose: string): DataSourceBinding => ({
  id,
  kind: "postgres",
  system: "ArtHello OS PostgreSQL",
  sourceOfTruth: true,
  readOnly: true,
  location,
  purpose,
  freshnessCheck: "verify sync/provenance timestamp before analytical use",
  required: true,
});

export const PROCESS_DATA_BINDINGS: Partial<Record<ProcessId, ProcessDataBinding>> = {
  "owner-exceptions-brief": {
    processId: "owner-exceptions-brief",
    status: "partial",
    runPolicy: "allow-with-warning",
    blockers: [
      "Only ArtHello currently exposes a verified unified operational/financial data contour; other portfolio projects still need standard status adapters.",
    ],
    sources: [
      arthelloPostgres("arthello-finance", "lib/db/src/schema/finance.ts", "financial exceptions and material variances"),
      arthelloPostgres("arthello-ledger", "lib/db/src/schema/ledger.ts", "ledger and accounting exceptions"),
      arthelloPostgres("arthello-front-office", "lib/db/src/schema/front-office.ts", "lead/front-office execution exceptions"),
      {
        id: "arthello-system-audit",
        kind: "api-route",
        system: "ArtHello OS API",
        sourceOfTruth: false,
        readOnly: true,
        location: "artifacts/api-server/src/routes/system-audit.ts",
        purpose: "system health and audit exceptions",
        required: true,
      },
      {
        id: "arthello-sync-health",
        kind: "api-route",
        system: "ArtHello OS API",
        sourceOfTruth: false,
        readOnly: true,
        location: "artifacts/api-server/src/routes/integrations.ts",
        purpose: "integration freshness and sync failures",
        required: true,
      },
    ],
  },

  "opportunity-discovery-engine": {
    processId: "opportunity-discovery-engine",
    status: "active",
    runPolicy: "allow",
    blockers: [],
    sources: [
      {
        id: "fresh-external-research",
        kind: "web-research",
        system: "Opportunity Discovery research runtime",
        sourceOfTruth: false,
        readOnly: true,
        location: "current external web research; no static cached market dataset",
        purpose: "fresh market signals, regulation, demand/supply imbalances, competitors and proven adjacent models",
        freshnessCheck: "at least one time-sensitive source must match the requested/current period",
        required: true,
      },
    ],
  },

  "revenue-leakage-agent": {
    processId: "revenue-leakage-agent",
    status: "active",
    runPolicy: "allow",
    blockers: [],
    sources: [
      arthelloPostgres("crm", "lib/db/src/schema/crm.ts", "leads, funnels, follow-up and conversion state"),
      arthelloPostgres("education", "lib/db/src/schema/educational.ts", "students, groups, capacity and educational relationships"),
      arthelloPostgres("alfa-sync", "lib/db/src/schema/alpha-sync.ts", "AlfaCRM synchronized operational facts"),
      arthelloPostgres("banking", "lib/db/src/schema/banking.ts", "actual bank cash receipts"),
      arthelloPostgres("reconciliation", "lib/db/src/schema/reconciliation.ts", "bank/operational reconciliation confidence"),
      arthelloPostgres("finance", "lib/db/src/schema/finance.ts", "accruals, tariffs and financial facts"),
      arthelloPostgres("front-office", "lib/db/src/schema/front-office.ts", "website/front-office lead handling"),
      {
        id: "website-leads",
        kind: "api-route",
        system: "ArtHello OS API",
        sourceOfTruth: false,
        readOnly: true,
        location: "artifacts/api-server/src/lib/webhooks/website-lead-service.ts",
        purpose: "incoming website lead evidence",
        required: false,
      },
    ],
  },

  "ikioma-deal-gate": {
    processId: "ikioma-deal-gate",
    status: "blocked",
    runPolicy: "deny",
    blockers: [
      "The accessible ikioma-site repository is a presentation layer and does not contain the commercial deal/cost ledger.",
      "PROJECT_PASSPORT points commercial requests to a private StroikaOS contour, but no StroikaOS repository or verified Drive dataset is currently accessible.",
      "Do not derive margin or minimum safe price from public preliminary website prices.",
    ],
    sources: [],
  },

  "automatic-product-qa": {
    processId: "automatic-product-qa",
    status: "active",
    runPolicy: "allow",
    blockers: [],
    sources: [
      {
        id: "github-source-change",
        kind: "github-ci",
        system: "GitHub",
        sourceOfTruth: true,
        readOnly: true,
        location: "repository commit / pull request diff",
        purpose: "actual implementation diff against approved scope",
        required: true,
      },
      {
        id: "arthello-quality-workflow",
        kind: "github-ci",
        system: "GitHub Actions",
        sourceOfTruth: false,
        readOnly: true,
        location: ".github/workflows/quality.yml",
        purpose: "typecheck, integration/security tests and full build evidence",
        required: true,
      },
      {
        id: "arthello-front-office-tests",
        kind: "github-ci",
        system: "ArtHello test suite",
        sourceOfTruth: false,
        readOnly: true,
        location: "artifacts/api-server/test + artifacts/alpha-crm-sync/test + sites-control/tests",
        purpose: "functional, security and regression evidence",
        required: true,
      },
    ],
  },
};

export function getProcessDataBinding(processId: ProcessId): ProcessDataBinding | undefined {
  return PROCESS_DATA_BINDINGS[processId];
}

export function canRunOnRealData(processId: ProcessId): { allowed: boolean; status?: BindingStatus; reasons: string[] } {
  const binding = getProcessDataBinding(processId);
  if (!binding) return { allowed: false, reasons: ["No real-data binding is registered for this process."] };

  if (binding.runPolicy === "deny") {
    return { allowed: false, status: binding.status, reasons: binding.blockers };
  }

  const reasons = binding.runPolicy === "allow-with-warning" ? binding.blockers : [];
  return { allowed: true, status: binding.status, reasons };
}
