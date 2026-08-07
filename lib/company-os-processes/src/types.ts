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
  | "assumption-reality-check";

export type ProjectSignal =
  | "education-capacity"
  | "receivables"
  | "marketing-experiment"
  | "founder-repeat"
  | "financial-model";

export type ProcessMode = "automatic" | "advisory" | "on-demand";

export interface ProjectContext {
  projectId: string;
  signals: ProjectSignal[];
  expectedBenefit?: number;
  expectedProcessCost?: number;
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
