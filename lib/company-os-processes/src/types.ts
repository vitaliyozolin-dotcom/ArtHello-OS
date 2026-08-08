export type FundamentalAgent =
  | "memory"
  | "intelligence"
  | "competence-network"
  | "execution"
  | "evolution";

export type ProcessId =
  | "capacity-enrollment-planner"
  | "receivables-orchestrator"
  | "growth-experiment-engine"
  | "founder-bottleneck-miner"
  | "assumption-reality-check"
  | "owner-exceptions-brief"
  | "opportunity-discovery-engine"
  | "revenue-leakage-agent"
  | "ikioma-deal-gate"
  | "automatic-product-qa";

export type ProjectSignal =
  | "education-capacity"
  | "receivables"
  | "marketing-experiment"
  | "founder-repeat"
  | "financial-model"
  | "portfolio-exception"
  | "opportunity-discovery"
  | "revenue-leakage"
  | "ikioma-deal"
  | "product-change";

export type ProcessMode = "automatic" | "advisory" | "on-demand";

export interface ProjectContext {
  projectId: string;
  signals: ProjectSignal[];
  expectedBenefit?: number;
  expectedProcessCost?: number;
  /** When true, processes without a verified real-data binding are not selected. */
  requireRealData?: boolean;
}

export interface ProcessDefinition {
  id: ProcessId;
  name: string;
  purpose: string;
  mode: ProcessMode;
  triggers: ProjectSignal[];
  agents: FundamentalAgent[];
  outputs: string[];
  guardrails: string[];
  pilot: string;
}

export interface ProcessSelection {
  process: ProcessDefinition;
  reason: string;
}
