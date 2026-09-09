export type PublicationMetric = {
  id: string;
  reach: number;
  views: number;
  reactions: number;
  clicks: number;
  leads: number;
  contracts: number;
  revenueMinor: number;
};

export function publicationRates(row: PublicationMetric) {
  return {
    engagementPercent: row.reach ? round(row.reactions / row.reach * 100) : 0,
    clickPercent: row.views ? round(row.clicks / row.views * 100) : 0,
    leadPercent: row.clicks ? round(row.leads / row.clicks * 100) : 0,
    contractPercent: row.leads ? round(row.contracts / row.leads * 100) : 0,
  };
}

export function contentSummary(rows: PublicationMetric[]) {
  return rows.reduce((summary, row) => ({
    reach: summary.reach + row.reach,
    views: summary.views + row.views,
    reactions: summary.reactions + row.reactions,
    clicks: summary.clicks + row.clicks,
    leads: summary.leads + row.leads,
    contracts: summary.contracts + row.contracts,
    revenueMinor: summary.revenueMinor + row.revenueMinor,
  }), { reach: 0, views: 0, reactions: 0, clicks: 0, leads: 0, contracts: 0, revenueMinor: 0 });
}

export function evidenceBasedRanking<T extends PublicationMetric>(rows: T[]) {
  return [...rows].sort((left, right) =>
    right.revenueMinor - left.revenueMinor ||
    right.contracts - left.contracts ||
    right.leads - left.leads ||
    right.clicks - left.clicks,
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
