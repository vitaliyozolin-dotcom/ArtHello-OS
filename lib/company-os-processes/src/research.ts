export type ResearchDepth = "light" | "standard" | "deep" | "critical";

export interface ResearchSource {
  id: string;
  kind: "internal" | "primary_external" | "secondary_external" | "estimate";
  title: string;
  freshness?: string;
  reliability: "high" | "medium" | "low";
  supports: string[];
  conflicts?: string[];
}

export interface ResearchScenario {
  name: "downside" | "base" | "upside" | "alternative";
  assumptions: Record<string, string | number | boolean>;
  outcome: string;
  failureConditions: string[];
}

export interface ResearchProtocolInput {
  question: string;
  projectId: string;
  decisionType: "operational" | "financial" | "strategic" | "investment" | "market" | "location" | "product";
  reversible: boolean;
  materiality: "low" | "medium" | "high" | "critical";
  budgetExposure?: number;
  knownFacts?: string[];
  assumptions?: string[];
}

export interface ResearchProtocolPlan {
  depth: ResearchDepth;
  dimensions: string[];
  minimumIndependentSources: number;
  requiresPrimarySources: boolean;
  requiresSensitivityAnalysis: boolean;
  requiresCounterCase: boolean;
  requiresSecondPairOfEyes: boolean;
  mustSearchForPathToYes: boolean;
  confidenceRequired: number;
}

export interface SecondPairOfEyesReview {
  verdict: "pass" | "revise" | "insufficient_evidence";
  challengedAssumptions: string[];
  missingDimensions: string[];
  sourceConcerns: string[];
  alternativeExplanations: string[];
  strongestCounterCase: string;
  whatWouldChangeTheDecision: string[];
}

export interface ResearchResult {
  input: ResearchProtocolInput;
  plan: ResearchProtocolPlan;
  sources: ResearchSource[];
  scenarios: ResearchScenario[];
  sensitivities: string[];
  leveragePoints: string[];
  counterEvidence: string[];
  pathToYes: string[];
  confidence: number;
  unknowns: string[];
  verificationPlan: string[];
  recommendation: string;
  secondPairOfEyes?: SecondPairOfEyesReview;
}

const BASE_DIMENSIONS = [
  "internal facts and historical performance",
  "source quality, freshness and conflicts",
  "unit economics and cash consequences",
  "demand and customer behaviour",
  "capacity and operational constraints",
  "competitive alternatives",
  "legal, regulatory and contractual constraints",
  "execution dependencies and bottlenecks",
  "downside, base and upside scenarios",
  "counter-evidence and alternative explanations",
  "sensitivity to critical assumptions",
  "leverage points that can change the outcome",
];

const DECISION_DIMENSIONS: Record<ResearchProtocolInput["decisionType"], string[]> = {
  operational: ["process throughput", "resource utilisation", "failure modes"],
  financial: ["cash timing", "working capital", "margin leakage", "tax and financing effects"],
  strategic: ["option value", "portfolio interaction", "second-order effects", "lock-in and reversibility"],
  investment: ["capital at risk", "payback", "opportunity cost", "exit/stop conditions"],
  market: ["TAM/SAM/SOM", "segments", "willingness to pay", "substitutes", "acquisition channels"],
  location: ["catchment by travel time", "walking/transit/driving accessibility", "age structure", "competing supply", "planned development", "barriers and natural boundaries"],
  product: ["job to be done", "adoption friction", "retention", "distribution", "build-vs-reuse"],
};

export function buildResearchPlan(input: ResearchProtocolInput): ResearchProtocolPlan {
  const depth: ResearchDepth =
    input.materiality === "critical" ? "critical" :
    input.materiality === "high" ? "deep" :
    input.materiality === "medium" ? "standard" : "light";

  const deep = depth === "deep" || depth === "critical";

  return {
    depth,
    dimensions: [...BASE_DIMENSIONS, ...DECISION_DIMENSIONS[input.decisionType]],
    minimumIndependentSources: depth === "critical" ? 5 : deep ? 3 : depth === "standard" ? 2 : 1,
    requiresPrimarySources: depth !== "light",
    requiresSensitivityAnalysis: depth !== "light",
    requiresCounterCase: true,
    requiresSecondPairOfEyes: deep || !input.reversible,
    mustSearchForPathToYes: true,
    confidenceRequired: depth === "critical" ? 0.85 : deep ? 0.75 : 0.65,
  };
}

export function researchGate(result: ResearchResult): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const independentSources = new Set(result.sources.map((source) => source.id)).size;

  if (independentSources < result.plan.minimumIndependentSources) reasons.push("insufficient independent sources");
  if (result.plan.requiresPrimarySources && !result.sources.some((source) => source.kind === "primary_external" || source.kind === "internal")) reasons.push("no primary/internal evidence");
  if (result.scenarios.length < 3 && result.plan.depth !== "light") reasons.push("fewer than three scenarios");
  if (result.plan.requiresSensitivityAnalysis && result.sensitivities.length === 0) reasons.push("sensitivity analysis missing");
  if (result.plan.requiresCounterCase && result.counterEvidence.length === 0) reasons.push("counter-case missing");
  if (result.plan.mustSearchForPathToYes && result.pathToYes.length === 0) reasons.push("path-to-yes search missing");
  if (result.confidence < result.plan.confidenceRequired) reasons.push("confidence below threshold");
  if (result.plan.requiresSecondPairOfEyes && !result.secondPairOfEyes) reasons.push("second-pair-of-eyes review missing");
  if (result.secondPairOfEyes && result.secondPairOfEyes.verdict !== "pass") reasons.push(`second-pair-of-eyes: ${result.secondPairOfEyes.verdict}`);

  return { allowed: reasons.length === 0, reasons };
}
