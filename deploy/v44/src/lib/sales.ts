export const SALES_STAGES = [
  "Первый клик",
  "Заявка",
  "Консультация",
  "Посещение",
  "Договор",
  "Начисление",
  "Платёж",
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];

export type FunnelLead = {
  stage: string;
  status: string;
};

export function buildFunnel(leads: FunnelLead[]) {
  return SALES_STAGES.map((stage, index) => {
    const reached = leads.filter((lead) => {
      const leadIndex = SALES_STAGES.indexOf(lead.stage as SalesStage);
      return leadIndex >= index;
    }).length;
    const previous = index === 0
      ? leads.length
      : leads.filter((lead) => SALES_STAGES.indexOf(lead.stage as SalesStage) >= index - 1).length;
    return {
      stage,
      reached,
      conversionPercent: previous === 0 ? 0 : Math.round((reached / previous) * 100),
    };
  });
}

export function nextSalesStage(stage: string) {
  const index = SALES_STAGES.indexOf(stage as SalesStage);
  if (index < 0 || index === SALES_STAGES.length - 1) return null;
  return SALES_STAGES[index + 1];
}

export function scoreCampaigns<T extends { campaignId: string; stage: string }>(
  leads: T[],
  revenueByLead: Record<string, number>,
  leadId: (lead: T) => string,
) {
  const rows = new Map<string, { campaignId: string; leads: number; contracts: number; payments: number; revenueMinor: number }>();
  for (const lead of leads) {
    const campaignId = lead.campaignId || "Без кампании";
    const row = rows.get(campaignId) ?? { campaignId, leads: 0, contracts: 0, payments: 0, revenueMinor: 0 };
    row.leads += 1;
    const stageIndex = SALES_STAGES.indexOf(lead.stage as SalesStage);
    if (stageIndex >= SALES_STAGES.indexOf("Договор")) row.contracts += 1;
    if (stageIndex >= SALES_STAGES.indexOf("Платёж")) row.payments += 1;
    row.revenueMinor += revenueByLead[leadId(lead)] ?? 0;
    rows.set(campaignId, row);
  }
  return [...rows.values()].sort((left, right) => right.revenueMinor - left.revenueMinor || right.leads - left.leads);
}

export function riskExplanation(score: number, factors: string[]) {
  const band = score >= 65 ? "Высокий" : score >= 30 ? "Средний" : "Низкий";
  return {
    score,
    band,
    factors: factors.filter(Boolean),
    disclaimer: "Сигнал для проверки менеджером, а не автоматическое решение о клиенте",
  };
}
