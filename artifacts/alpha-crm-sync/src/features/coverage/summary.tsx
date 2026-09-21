import {
  useGetCoverageSummary,
  type AlphaSyncBatch,
  type CoverageSummaryEntityRow,
} from "@workspace/api-client-react";

import { coverageStatusColor } from "./components";
import {
  formatCoverageDuration as fmtDur,
  formatCoverageTimestamp as fmtTs,
} from "./format";

const BATCH_STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export function coverageNormalizationPercent(
  totalValue: string | number,
  normalizedValue: string | number,
) {
  const total = Number(totalValue);
  if (total <= 0) return 0;
  return Math.round((Number(normalizedValue) / total) * 100);
}

export function SummaryTable() {
  const { data, isLoading } = useGetCoverageSummary();

  if (isLoading)
    return <div className="h-32 bg-gray-100 rounded-[12px] animate-pulse" />;
  if (!data) return null;

  const byEntity = (data.byEntity ?? []) as CoverageSummaryEntityRow[];
  const regCounts =
    (data.registryStatusCounts as { status: string; cnt: string }[]) ?? [];
  const issueCounts =
    (data.openIssueCounts as { severity: string; cnt: string }[]) ?? [];
  const lastBatch = data.lastBatch as AlphaSyncBatch | null;

  return (
    <div className="space-y-3">
      {/* Registry status pills */}
      <div className="flex gap-2 flex-wrap">
        {regCounts.map(({ status, cnt }) => (
          <span
            key={status}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${coverageStatusColor(status)}`}
          >
            {status}: {cnt}
          </span>
        ))}
        {issueCounts.map(({ severity, cnt }) => (
          <span
            key={severity}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${severity === "critical" ? "bg-red-100 text-red-700 border-red-200" : severity === "warning" ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}
          >
            {severity} issues: {cnt}
          </span>
        ))}
      </div>

      {/* Last batch */}
      {lastBatch && (
        <div className="text-[11px] text-gray-500 font-mono bg-gray-50 rounded px-2 py-1">
          Last batch:{" "}
          <span
            className={`font-bold ${BATCH_STATUS_COLORS[lastBatch.status ?? ""] ?? ""} px-1 rounded`}
          >
            {(lastBatch.status ?? "").toUpperCase()}
          </span>{" "}
          mode={lastBatch.mode} fetched={lastBatch.total_fetched ?? 0} saved=
          {lastBatch.total_saved ?? 0} errors={lastBatch.total_errors ?? 0} dur=
          {fmtDur(lastBatch.duration_ms)} at={fmtTs(lastBatch.started_at)}
        </div>
      )}

      {/* By entity table */}
      {byEntity.length > 0 && (
        <div className="border border-gray-200 rounded-[10px] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-semibold text-gray-600">
                  Entity
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">
                  Raw saved
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">
                  Normalized
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">
                  Missing ID
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">
                  Branches
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">
                  Last synced
                </th>
              </tr>
            </thead>
            <tbody>
              {byEntity.map((row) => {
                const total = Number(row.total_raw);
                const norm = Number(row.normalized);
                const pct = coverageNormalizationPercent(total, norm);
                return (
                  <tr
                    key={row.entity_type}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-[10px] text-violet-700">
                      {row.entity_type}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {Number(row.total_raw).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`tabular-nums font-semibold ${pct === 100 ? "text-emerald-600" : pct > 50 ? "text-amber-600" : "text-gray-500"}`}
                      >
                        {norm > 0 ? `${norm} (${pct}%)` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                      {Number(row.missing_id) > 0
                        ? Number(row.missing_id)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                      {row.branches}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {fmtTs(row.last_synced)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {byEntity.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-[13px]">
          Нет данных в alpha_raw_records — запустите{" "}
          <strong>Run Raw Sync</strong>
        </div>
      )}
    </div>
  );
}
