import React, { useState } from "react";
import {
  useGetCoverageRegistry,
  type CoverageEndpointEntry,
} from "@workspace/api-client-react";
import { ChevronDown, ChevronRight, Copy, CopyCheck } from "lucide-react";

import { StatusBadge } from "./components";
import { formatCoverageTimestamp as fmtTs } from "./format";

const ERROR_STATUSES = new Set([
  "ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
  "NOT_EXPOSED",
]);

export function countCoverageRegistryStatuses(
  registry: ReadonlyArray<{ status?: string | null }>,
) {
  return {
    ok: registry.filter((row) => row.status === "OK").length,
    empty: registry.filter((row) => row.status === "EMPTY").length,
    error: registry.filter((row) => ERROR_STATUSES.has(row.status ?? ""))
      .length,
    unknown: registry.filter((row) => row.status === "UNKNOWN").length,
    total: registry.length,
  };
}

export function RegistryTable({ branchId }: { branchId: string }) {
  const { data, isLoading } = useGetCoverageRegistry({ branchId });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const registry = (data?.registry ?? []) as CoverageEndpointEntry[];

  const {
    ok: okCount,
    empty: emptyCount,
    error: errCount,
    unknown: unknownCount,
  } = countCoverageRegistryStatuses(registry);

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (registry.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-[13px]">
        Нет данных — запустите <strong>Run Discovery</strong>
      </div>
    );
  }

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div>
      {/* Stats row */}
      <div className="flex gap-3 mb-3 flex-wrap text-[11px]">
        <span className="text-emerald-600 font-semibold">✓ OK: {okCount}</span>
        <span className="text-yellow-600 font-semibold">
          ◌ EMPTY: {emptyCount}
        </span>
        <span className="text-red-600 font-semibold">
          ✕ ERROR/NOT_FOUND: {errCount}
        </span>
        <span className="text-gray-400">? UNKNOWN: {unknownCount}</span>
        <span className="text-gray-400 ml-auto">Total: {registry.length}</span>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  Entity
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  Endpoint
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  Status
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  HTTP
                </th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  Records
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  Last checked
                </th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                  Next action
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {registry.map((row) => {
                const isExpanded = expandedId === row.id;
                return (
                  <React.Fragment key={row.id ?? row.entity_key}>
                    <tr
                      className="border-b border-gray-100 hover:bg-gray-50/60 cursor-pointer"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : (row.id ?? null))
                      }
                    >
                      <td className="px-3 py-2 font-mono text-[10px] text-violet-700 whitespace-nowrap">
                        {row.entity_key ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap max-w-[160px] truncate">
                        {row.endpoint ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status ?? "UNKNOWN"} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {row.http_status ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {row.records_fetched !== null &&
                        row.records_fetched !== undefined
                          ? row.records_fetched.toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        {fmtTs(row.last_checked_at)}
                      </td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px]">
                        <span className="line-clamp-1">
                          {row.next_action ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-gray-400" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-950 text-gray-300">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="font-mono text-[10px] space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">endpoint:</span>
                              <span className="text-green-400">
                                {row.endpoint}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyText(
                                    row.endpoint ?? "",
                                    (row.id ?? "") + "-ep",
                                  );
                                }}
                                className="text-gray-500 hover:text-gray-300"
                              >
                                {copied === (row.id ?? "") + "-ep" ? (
                                  <CopyCheck className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                            {row.notes && (
                              <div>
                                <span className="text-gray-500">notes:</span>{" "}
                                {String(row.notes)}
                              </div>
                            )}
                            {row.error_message && (
                              <div>
                                <span className="text-red-400">error:</span>{" "}
                                <span className="text-red-300">
                                  {String(row.error_message)}
                                </span>
                              </div>
                            )}
                            {!!row.discovered_fields && (
                              <div>
                                <span className="text-gray-500">
                                  fields discovered:
                                </span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {(row.discovered_fields as string[]).map(
                                    (f) => (
                                      <span
                                        key={f}
                                        className="px-1 py-0.5 bg-gray-800 text-gray-300 rounded text-[9px]"
                                      >
                                        {f}
                                      </span>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                            {!!row.response_sample && (
                              <div>
                                <span className="text-gray-500">sample:</span>
                                <pre className="mt-1 text-[9px] text-gray-400 overflow-x-auto max-h-32">
                                  {JSON.stringify(row.response_sample, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
