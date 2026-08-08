import type { ResearchProtocolInput } from "./research";

export type DiscoveryMode = "sector" | "open";
export type OpportunityDecision = "kill" | "hold" | "test" | "build" | "scale";

export interface DiscoveryConstraints {
  sectors?: string[];
  geographies?: string[];
  maxInitialCapital?: number;
  targetPaybackMonths?: number;
  minimumGrossMargin?: number;
  timeToFirstRevenueMonths?: number;
  businessModel?: Array<"b2b" | "b2c" | "marketplace" | "saas" | "services" | "manufacturing" | "asset_light" | "asset_heavy">;
  strategicAssets?: string[];
  exclusions?: string[];
}

export interface OpportunitySignal {
  id: string;
  title: string;
  category: "demand_growth" | "supply_gap" | "price_pain" | "manual_process" | "technology_shift" | "regulatory_change" | "fragmentation" | "behaviour_change" | "infrastructure_gap" | "foreign_pattern";
  evidence: string[];
  freshness: string;
  confidence: number;
  implication: string;
}

export interface OpportunityHypothesis {
  id: string;
  title: string;
  customer: string;
  problem: string;
  whyNow: string[];
  revenueModel: string;
  supportingSignalIds: string[];
  founderAdvantages: string[];
  keyRisks: string[];
  criticalUnknowns: string[];
}

export interface OpportunityScorecard {
  marketNeed: number;
  willingnessToPay: number;
  supplyGap: number;
  grossMarginPotential: number;
  speedToRevenue: number;
  capitalEfficiency: number;
  scalability: number;
  defensibility: number;
  founderFit: number;
  evidenceQuality: number;
}

export interface RankedOpportunity {
  hypothesis: OpportunityHypothesis;
  scorecard: OpportunityScorecard;
  score: number;
  evidenceConfidence: number;
  decision: OpportunityDecision;
  nextProof: string[];
  drpInput: ResearchProtocolInput;
}

export interface DiscoveryRequest {
  mode: DiscoveryMode;
  prompt: string;
  constraints?: DiscoveryConstraints;
  targetHypotheses?: number;
  shortlistSize?: number;
}

export interface DiscoveryPlan {
  scanDimensions: string[];
  minimumSignals: number;
  targetHypotheses: number;
  shortlistSize: number;
  requiresCurrentExternalResearch: boolean;
  requiresInternalReuseScan: boolean;
  requiresFounderFit: boolean;
}

const SCAN_DIMENSIONS = [
  "demand growth and search behaviour",
  "supply shortages and poor incumbent experience",
  "high prices relative to delivered value",
  "expensive manual workflows suitable for automation",
  "technology cost curves and newly feasible products",
  "regulatory changes that create mandatory demand",
  "fragmented markets with weak operators",
  "new customer behaviours and distribution channels",
  "infrastructure gaps created by growing categories",
  "business models proven abroad but underpenetrated locally",
  "large-player investment, hiring and M&A signals",
  "reviews, complaints and recurring unmet needs",
  "existing Company OS assets that create an unfair advantage",
];

const DEFAULT_WEIGHTS: Record<keyof OpportunityScorecard, number> = {
  marketNeed: 0.16,
  willingnessToPay: 0.14,
  supplyGap: 0.12,
  grossMarginPotential: 0.11,
  speedToRevenue: 0.1,
  capitalEfficiency: 0.09,
  scalability: 0.08,
  defensibility: 0.06,
  founderFit: 0.08,
  evidenceQuality: 0.06,
};

export function buildDiscoveryPlan(request: DiscoveryRequest): DiscoveryPlan {
  const targetHypotheses = Math.max(10, request.targetHypotheses ?? (request.mode === "open" ? 30 : 20));
  const shortlistSize = Math.max(3, Math.min(request.shortlistSize ?? 5, targetHypotheses));

  return {
    scanDimensions: SCAN_DIMENSIONS,
    minimumSignals: request.mode === "open" ? 40 : 25,
    targetHypotheses,
    shortlistSize,
    requiresCurrentExternalResearch: true,
    requiresInternalReuseScan: true,
    requiresFounderFit: true,
  };
}

export function scoreOpportunity(scorecard: OpportunityScorecard): number {
  const entries = Object.entries(DEFAULT_WEIGHTS) as Array<[keyof OpportunityScorecard, number]>;
  const weighted = entries.reduce((sum, [key, weight]) => {
    const value = Math.max(0, Math.min(100, scorecard[key]));
    return sum + value * weight;
  }, 0);
  return Math.round(weighted * 10) / 10;
}

export function classifyOpportunity(score: number, evidenceConfidence: number): OpportunityDecision {
  if (evidenceConfidence < 0.45) return "hold";
  if (score < 45) return "kill";
  if (score < 62) return "hold";
  if (score < 78) return "test";
  return evidenceConfidence >= 0.8 ? "build" : "test";
}

export function toResearchProtocolInput(opportunity: OpportunityHypothesis, score: number): ResearchProtocolInput {
  return {
    question: `Should we pursue opportunity: ${opportunity.title}? Under what conditions does it become economically attractive?`,
    projectId: `opportunity:${opportunity.id}`,
    decisionType: "market",
    reversible: true,
    materiality: score >= 78 ? "high" : "medium",
    knownFacts: opportunity.whyNow,
    assumptions: opportunity.criticalUnknowns,
  };
}

export function discoveryGate(args: {
  request: DiscoveryRequest;
  plan: DiscoveryPlan;
  signals: OpportunitySignal[];
  opportunities: RankedOpportunity[];
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const confidentSignals = args.signals.filter((signal) => signal.confidence >= 0.6);

  if (args.signals.length < args.plan.minimumSignals) reasons.push("market scan is too shallow");
  if (confidentSignals.length < Math.ceil(args.plan.minimumSignals * 0.5)) reasons.push("too few sufficiently supported signals");
  if (args.opportunities.length < args.plan.shortlistSize) reasons.push("shortlist is incomplete");
  if (args.opportunities.some((item) => item.hypothesis.supportingSignalIds.length < 2)) reasons.push("one or more opportunities rely on a single market signal");
  if (args.plan.requiresFounderFit && args.opportunities.some((item) => item.hypothesis.founderAdvantages.length === 0)) reasons.push("founder/company advantage was not evaluated");
  if (args.opportunities.some((item) => item.nextProof.length === 0)) reasons.push("one or more opportunities have no concrete next proof");

  return { allowed: reasons.length === 0, reasons };
}
