import { formatRubleNumber, formatRubles } from "@workspace/shared/money";
import { apiFetch } from "@workspace/api-client-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@/context/NavigationContext";
import PnlPage from "@/pages/pnl";
import {
  useGetBankConnectors,
  useCreateBankConnector,
  useUpdateBankConnector,
  useDeleteBankConnector,
  useTriggerBankSync,
  useGetBankingCashflow,
  useGetBankingAlerts,
  useGetBankingForecast,
  useGetBankSyncRuns,
  useGetBankAccounts,
  useGetBankConnectorHealth,
  useStartTochkaOAuth,
  useGetTochkaOAuthStatus,
  useSubmitTochkaOAuthCallback,
  useGetBankingTransactions,
  useGetBankingTransactionStats,
  useGetBankDataTruth,
  useGetBankingMatchStats,
  useMatchBankingTransaction,
  useGetLedgerCashflowReport,
  useGetLedgerFinancialStats,
  getGetLedgerCashflowReportQueryKey,
  getGetLedgerFinancialStatsQueryKey,
  getGetBankingTransactionsQueryKey,
  getGetBankingTransactionStatsQueryKey,
  getGetBankDataTruthQueryKey,
  getGetBankConnectorsQueryKey,
  getGetBankingCashflowQueryKey,
  getGetBankingAlertsQueryKey,
  getGetBankingForecastQueryKey,
  getGetBankSyncRunsQueryKey,
  getGetBankAccountsQueryKey,
  getGetBankConnectorHealthQueryKey,
  getGetTochkaOAuthStatusQueryKey,
  getGetBankingMatchStatsQueryKey,
  useGetArticles,
  useGetCategorizationRules,
  getGetCategorizationRulesQueryKey,
  useGetRecurringObligations,
  useDetectRecurringObligations,
  usePatchRecurringObligation,
  useGetRecurringUpcoming,
  getGetRecurringObligationsQueryKey,
  getGetRecurringUpcomingQueryKey,
  useListPayableObligations,
  useGetPayablesSummary,
  useGetPayablesUpcoming,
  useCreatePayableObligation,
  useApprovePayableObligation,
  useCancelPayableObligation,
  useMarkPaidPayableObligation,
  useUpdatePayableObligation,
  getListPayableObligationsQueryKey,
  getGetPayablesSummaryQueryKey,
  getGetPayablesUpcomingQueryKey,
  type BankConnectorRow,
  type ConnectorHealthDetail,
  type BankingMatchStats,
  type CategorizationRuleItem,
  type RecurringObligation,
  type PayableObligation,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Banknote,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  ChevronDown,
  Clock,
  Plug,
  Wifi,
  WifiOff,
  BarChart3,
  CircleDollarSign,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  ArrowDownLeft,
  ShieldCheck,
  ShieldX,
  Activity,
  Key,
  Globe,
  Info,
  Copy,
  CopyCheck,
  ExternalLink,
  ArrowRight,
  CheckCheck,
  Lock,
  Unlock,
  Timer,
  AlertCircle,
  Terminal,
  Database,
  List,
  Search,
  SlidersHorizontal,
  Bell,
  Building2,
  UserPlus,
  Ban,
  Link2,
  Briefcase,
  FileText,
  Users,
  Server,
  Sparkles,
  ArrowLeftRight,
  ClipboardList,
  Plus,
  ThumbsUp,
  OctagonX,
  Wallet,
} from "lucide-react";

// ─── Client-side suggestion engine ────────────────────────────────────────────
type SuggestionResult = {
  suggestedAction: string | null;
  suggestedArticleId: string | null;
  suggestedArticleName: string | null;
  suggestedArticleCode: string | null;
  confidence: number;
  matchedRuleName: string | null;
} | null;

function applyRules(
  tx: TxItem,
  rules: CategorizationRuleItem[],
): SuggestionResult {
  const txDir = tx.direction ?? "unknown";
  for (const rule of rules) {
    if (!rule.matchField || !rule.matchType || !rule.pattern) continue;
    // P3.2: direction guard — skip rule when direction doesn't match
    const dir = rule.matchDirection ?? "any";
    if (dir !== "any" && dir !== txDir) continue;

    const rawField = (() => {
      switch (rule.matchField) {
        case "counterparty":
          return tx.counterpartyName ?? "";
        case "purpose":
          return tx.purpose ?? "";
        case "direction":
          return tx.direction ?? "";
        default:
          return "";
      }
    })();
    const field = rawField.toLowerCase();
    const pattern = rule.pattern.toLowerCase();
    let matches = false;
    switch (rule.matchType) {
      case "contains":
        matches = field.includes(pattern);
        break;
      case "equals":
        matches = field === pattern;
        break;
      case "starts_with":
        matches = field.startsWith(pattern);
        break;
      case "regex":
        try {
          matches = new RegExp(rule.pattern, "i").test(rawField);
        } catch {
          matches = false;
        }
        break;
    }
    if (matches) {
      return {
        suggestedAction: rule.suggestedAction ?? null,
        suggestedArticleId: rule.suggestedArticleId ?? null,
        suggestedArticleName: rule.suggestedArticleName ?? null,
        suggestedArticleCode: rule.suggestedArticleCode ?? null,
        confidence: rule.confidence,
        matchedRuleName: rule.ruleName ?? null,
      };
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  return formatRubles(n);
};

const fmtNum = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  return formatRubleNumber(n);
};

const fmtDate = (v: string | null | undefined) => {
  if (!v) return "—";
  return new Date(v).toLocaleString("ru", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const BANK_META: Record<
  string,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    authType: string;
    configFields: string[];
  }
> = {
  tochka: {
    label: "Точка",
    color: "text-yellow-700",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
    authType: "OAuth 2.0",
    configFields: ["clientId", "clientSecret"],
  },
  tinkoff: {
    label: "Т-Банк",
    color: "text-yellow-900",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-300",
    authType: "API Key",
    configFields: ["apiKey"],
  },
  vtb: {
    label: "ВТБ",
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    authType: "OAuth 2.0",
    configFields: ["clientId", "clientSecret"],
  },
};

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const cfg =
    status === "active"
      ? {
          cls: "bg-green-100 text-green-800 border-green-200",
          icon: <CheckCircle2 className="w-3 h-3" />,
          label: "Активен",
        }
      : status === "connected_partial"
        ? {
            cls: "bg-amber-100 text-amber-800 border-amber-200",
            icon: <Activity className="w-3 h-3" />,
            label: "Частично",
          }
        : status === "error"
          ? {
              cls: "bg-red-100 text-red-800 border-red-200",
              icon: <XCircle className="w-3 h-3" />,
              label: "Ошибка",
            }
          : status === "not_configured"
            ? {
                cls: "bg-gray-100 text-gray-700 border-gray-200",
                icon: <Settings className="w-3 h-3" />,
                label: "Не настроен",
              }
            : {
                cls: "bg-gray-100 text-gray-600 border-gray-200",
                icon: <Minus className="w-3 h-3" />,
                label: "Неактивен",
              };
  return (
    <Badge
      className={`${cfg.cls} flex items-center gap-1 px-2 py-0.5 text-[11px] border font-medium`}
    >
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

// ─── Per-field hints for config dialogs ──────────────────────────────────────
const FIELD_HINTS: Record<
  string,
  Record<string, { placeholder: string; description?: string }>
> = {
  tochka: {
    clientId: {
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      description: "OAuth 2.0 Client ID из личного кабинета Точки → Интеграции",
    },
    clientSecret: {
      placeholder: "ваш client_secret",
      description: "Client Secret. Хранится в зашифрованном виде.",
    },
  },
  tinkoff: {
    apiKey: {
      placeholder: "ваш API ключ",
      description: "API ключ из личного кабинета Т-Банк Бизнес",
    },
  },
  vtb: {
    clientId: {
      placeholder: "client_id",
      description: "OAuth Client ID из ЛК ВТБ",
    },
    clientSecret: {
      placeholder: "client_secret",
      description: "OAuth Client Secret",
    },
  },
};

// ─── Connector config dialog ───────────────────────────────────────────────────
interface ConfigDialogProps {
  connector: BankConnectorRow | null;
  bankName: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function ConfigDialog({
  connector,
  bankName,
  open,
  onClose,
  onSaved,
}: ConfigDialogProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const meta = BANK_META[bankName ?? ""] ?? BANK_META["tochka"];
  const qc = useQueryClient();

  const update = useUpdateBankConnector({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBankConnectorsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankingCashflowQueryKey() });
        onSaved();
        onClose();
      },
    },
  });

  const create = useCreateBankConnector({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBankConnectorsQueryKey() });
        onSaved();
        onClose();
      },
    },
  });

  const handleSave = () => {
    const config = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v.trim() !== ""),
    );
    if (connector) {
      update.mutate({
        id: connector.id,
        data: {
          config,
          connectorStatus:
            Object.keys(config).length > 0 ? "inactive" : "inactive",
        },
      });
    } else if (bankName) {
      create.mutate({
        data: { bankName: bankName as "tochka" | "tinkoff" | "vtb", config },
      });
    }
  };

  const isPending = update.isPending || create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Настройка {meta.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
            <strong>Метод авторизации:</strong> {meta.authType}
          </div>
          {meta.configFields.map((field) => {
            const hint = FIELD_HINTS[bankName ?? ""]?.[field];
            return (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={field} className="text-sm font-medium">
                  {field}
                </Label>
                <Input
                  id={field}
                  type={
                    field.toLowerCase().includes("secret") ||
                    field.toLowerCase().includes("key")
                      ? "password"
                      : "text"
                  }
                  placeholder={hint?.placeholder ?? field}
                  value={fields[field] ?? ""}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, [field]: e.target.value }))
                  }
                />
                {hint?.description && (
                  <p className="text-xs text-muted-foreground">
                    {hint.description}
                  </p>
                )}
              </div>
            );
          })}
          <div className="text-xs text-muted-foreground border-t pt-2 mt-1">
            Учётные данные хранятся в поле config в базе данных.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Debug block (collapsible raw HTTP details) ───────────────────────────────

function DebugBlock({
  debug,
  diagnosticCode,
  diagnosticMessage,
}: {
  debug?: ConnectorHealthDetail["debug"];
  diagnosticCode: string | null | undefined;
  diagnosticMessage: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = JSON.stringify(
      { diagnosticCode, diagnosticMessage, debug },
      null,
      2,
    );
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-2 border border-gray-200 rounded-md overflow-hidden text-xs">
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Activity className="w-3 h-3" />
          Технические детали
        </span>
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="bg-gray-900 text-gray-200 p-3 space-y-2">
          <div className="flex justify-end">
            <button
              className="text-gray-400 hover:text-white flex items-center gap-1"
              onClick={handleCopy}
            >
              {copied ? (
                <CopyCheck className="w-3 h-3 text-green-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
          {diagnosticCode && (
            <div>
              <span className="text-gray-500">code:</span>{" "}
              <span className="text-yellow-300">{diagnosticCode}</span>
            </div>
          )}
          {debug?.tokenUrl && (
            <div>
              <span className="text-gray-500">token_url:</span>{" "}
              <span className="text-blue-300 break-all">{debug.tokenUrl}</span>
            </div>
          )}
          {debug?.clientId && (
            <div>
              <span className="text-gray-500">client_id:</span>{" "}
              <span className="text-green-300">{debug.clientId}</span>
            </div>
          )}
          {debug?.customerCode !== undefined && (
            <div>
              <span className="text-gray-500">customer_code: </span>
              <span
                className={
                  debug.customerCode &&
                  debug.customerCode !== "(не указан — возможно нужен)" &&
                  debug.customerCode !== "(не получен)"
                    ? "text-green-300"
                    : "text-red-300"
                }
              >
                {debug.customerCode ?? "(не указан)"}
              </span>
            </div>
          )}
          {debug?.resolvedCustomerCode !== undefined &&
            debug.resolvedCustomerCode !== debug.customerCode && (
              <div>
                <span className="text-gray-500">resolved_customer_code: </span>
                <span
                  className={
                    debug.resolvedCustomerCode &&
                    debug.resolvedCustomerCode !== "(не получен)"
                      ? "text-green-300"
                      : "text-red-400"
                  }
                >
                  {debug.resolvedCustomerCode ?? "(не получен)"}
                </span>
              </div>
            )}
          {debug?.introspectSub !== undefined && (
            <div>
              <span className="text-gray-500">introspect_sub: </span>
              <span
                className={
                  debug.introspectSub && debug.introspectSub !== "(не получен)"
                    ? "text-cyan-300"
                    : "text-amber-400"
                }
              >
                {debug.introspectSub}
              </span>
            </div>
          )}
          {debug?.customerCodeSource !== undefined && (
            <div>
              <span className="text-gray-500">customer_code_source: </span>
              <span
                className={
                  debug.customerCodeSource === "introspect"
                    ? "text-cyan-300"
                    : debug.customerCodeSource === "customers_api"
                      ? "text-yellow-300"
                      : "text-red-400"
                }
              >
                {debug.customerCodeSource}
              </span>
            </div>
          )}
          {debug?.sentCustomerHeader !== undefined && (
            <div>
              <span className="text-gray-500">sent_customer_header: </span>
              <span
                className={
                  debug.sentCustomerHeader
                    ? "text-green-300"
                    : "text-red-400 font-bold"
                }
              >
                {String(debug.sentCustomerHeader)}
              </span>
              {!debug.sentCustomerHeader && (
                <span className="text-red-400 ml-2">
                  ⚠ CustomerCode header не отправлен!
                </span>
              )}
            </div>
          )}
          {debug?.customersResponse && (
            <div className="border-t border-gray-700 pt-2 mt-1">
              <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
                CUSTOMERS RESPONSE
              </div>
              <pre className="whitespace-pre-wrap break-all text-cyan-200 text-[10px] max-h-32 overflow-y-auto">
                {debug.customersResponse}
              </pre>
            </div>
          )}
          {/* ─── Token validation block ──────────────────────── */}
          {debug?.tokenExists !== undefined && (
            <div className="border-t border-gray-700 pt-2 mt-1 space-y-1">
              <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
                TOKEN VALIDATION
              </div>
              <div>
                <span className="text-gray-500">token_exists: </span>
                <span
                  className={
                    debug.tokenExists
                      ? "text-green-300"
                      : "text-red-400 font-bold"
                  }
                >
                  {String(debug.tokenExists)}
                </span>
              </div>
              {debug?.tokenLength !== undefined &&
                debug.tokenLength !== null && (
                  <div>
                    <span className="text-gray-500">token_length: </span>
                    <span
                      className={
                        debug.tokenLength > 0
                          ? "text-green-300"
                          : "text-red-400"
                      }
                    >
                      {debug.tokenLength}
                    </span>
                    {debug.tokenLength > 0 && debug.tokenLength < 20 && (
                      <span className="text-red-400 ml-2">
                        ⚠ слишком короткий
                      </span>
                    )}
                  </div>
                )}
              {debug?.tokenTypeOf && (
                <div>
                  <span className="text-gray-500">token_typeof: </span>
                  <span
                    className={
                      debug.tokenTypeOf === "string"
                        ? "text-green-300"
                        : "text-red-400 font-bold"
                    }
                  >
                    {debug.tokenTypeOf}
                  </span>
                  {debug.tokenTypeOf !== "string" && (
                    <span className="text-red-400 ml-2">
                      ⚠ должен быть string!
                    </span>
                  )}
                </div>
              )}
              {debug?.tokenMasked && (
                <div>
                  <span className="text-gray-500">token_masked: </span>
                  <span className="text-yellow-300 font-mono">
                    {debug.tokenMasked}
                  </span>
                </div>
              )}
            </div>
          )}
          {/* ─── Final request block ─────────────────────────── */}
          {(debug?.requestUrl || debug?.accountsUrl) && (
            <div className="border-t border-gray-700 pt-2 mt-1 space-y-1">
              <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
                FINAL REQUEST
              </div>
              {debug?.accountsUrl && (
                <div>
                  <span className="text-gray-500">accounts_url:</span>{" "}
                  <span className="text-blue-300 break-all">
                    {debug.accountsUrl}
                  </span>
                </div>
              )}
              {debug?.requestUrl && debug.requestUrl !== debug.accountsUrl && (
                <div>
                  <span className="text-gray-500">request_url:</span>{" "}
                  <span className="text-blue-300 break-all">
                    {debug.requestUrl}
                  </span>
                </div>
              )}
              {debug?.sentHeaders && (
                <div>
                  <div className="text-gray-500 mb-1">sent_headers:</div>
                  <pre className="text-cyan-300 text-[10px] whitespace-pre-wrap">
                    {debug.sentHeaders}
                  </pre>
                </div>
              )}
            </div>
          )}
          {debug?.responseStatus !== undefined &&
            debug?.responseStatus !== null && (
              <div className="border-t border-gray-700 pt-2 mt-1 space-y-1">
                <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
                  RESPONSE
                </div>
                <div>
                  <span className="text-gray-500">status: </span>
                  <span
                    className={
                      debug.responseStatus >= 400
                        ? "text-red-300 font-bold"
                        : "text-green-300"
                    }
                  >
                    {debug.responseStatus}
                  </span>
                </div>
              </div>
            )}
          {debug?.responseBody && (
            <div>
              <div className="text-gray-500 mb-1">response_body:</div>
              <pre className="whitespace-pre-wrap break-all text-orange-200 text-[10px] max-h-40 overflow-y-auto">
                {debug.responseBody}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Connector health panel ───────────────────────────────────────────────────

function ConnectorHealthPanel({
  connectorId,
  bankName,
}: {
  connectorId: string;
  bankName: string;
}) {
  const meta = BANK_META[bankName] ?? BANK_META["tochka"];
  const {
    data: health,
    isFetching,
    refetch,
  } = useGetBankConnectorHealth(connectorId, {
    query: {
      queryKey: getGetBankConnectorHealthQueryKey(connectorId),
      enabled: false,
      staleTime: 0,
    },
  });

  const statusIcon = !health ? null : health.status === "active" ? (
    <ShieldCheck className="w-5 h-5 text-green-600" />
  ) : health.status === "not_configured" ? (
    <Settings className="w-5 h-5 text-gray-400" />
  ) : (
    <ShieldX className="w-5 h-5 text-red-500" />
  );

  return (
    <div className="border border-gray-200 rounded-xl p-4 mt-3 space-y-3 bg-gray-50/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Activity className="w-4 h-4 text-primary" />
          Диагностика {meta.label}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {health ? "Повторить" : "Проверить"}
        </Button>
      </div>

      {!health && !isFetching && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Нажмите «Проверить» для запуска диагностики соединения
        </p>
      )}

      {isFetching && (
        <div className="flex items-center gap-2 py-3 justify-center text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Выполняется диагностика...
        </div>
      )}

      {health && !isFetching && (
        <div className="space-y-3">
          {/* Status banner */}
          <div
            className={`flex items-start gap-3 p-3 rounded-lg border ${
              health.status === "active"
                ? "bg-green-50 border-green-200"
                : health.status === "not_configured"
                  ? "bg-gray-50 border-gray-200"
                  : "bg-red-50 border-red-200"
            }`}
          >
            {statusIcon}
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-semibold ${
                  health.status === "active"
                    ? "text-green-800"
                    : health.status === "not_configured"
                      ? "text-gray-700"
                      : "text-red-800"
                }`}
              >
                {health.message}
              </div>
              {health.diagnosticMessage &&
                health.diagnosticMessage !== health.message && (
                  <div className="text-xs mt-1 text-muted-foreground leading-snug">
                    {health.diagnosticMessage}
                  </div>
                )}
            </div>
          </div>

          {/* Checklist */}
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                label: "Авторизация (OAuth)",
                ok: health.authOk,
                icon: <Key className="w-3 h-3" />,
              },
              {
                label: "Доступ к счетам",
                ok: health.accountsAccessOk,
                icon: <CircleDollarSign className="w-3 h-3" />,
              },
              {
                label: "Scope: accounts",
                ok: health.hasAccountsScope,
                icon: <Globe className="w-3 h-3" />,
              },
              {
                label: "Scope: transactions",
                ok: health.hasTransactionsScope,
                icon: <Globe className="w-3 h-3" />,
              },
            ].map(({ label, ok, icon }) => (
              <div
                key={label}
                className={`flex items-center gap-2 p-2 rounded-md border text-xs ${
                  ok
                    ? "bg-green-50 border-green-200 text-green-800"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                <span className="shrink-0">{icon}</span>
                <span className="truncate">{label}</span>
                {ok ? (
                  <CheckCircle2 className="w-3 h-3 ml-auto shrink-0 text-green-600" />
                ) : (
                  <XCircle className="w-3 h-3 ml-auto shrink-0 text-red-500" />
                )}
              </div>
            ))}
          </div>

          {/* Token info */}
          {health.tokenExpiresAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Токен действителен до:{" "}
              <span className="font-medium text-foreground">
                {new Date(health.tokenExpiresAt).toLocaleString("ru", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          )}

          {/* Scopes granted */}
          {health.scopesGranted && health.scopesGranted.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {health.scopesGranted.map((s) => (
                <span
                  key={s}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* Account count */}
          {health.accountCount !== null &&
            health.accountCount !== undefined && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CircleDollarSign className="w-3 h-3" />
                Найдено счетов:{" "}
                <strong className="text-foreground">
                  {health.accountCount}
                </strong>
              </div>
            )}

          {/* Debug block */}
          {(health.debug || health.diagnosticCode !== "ok") && (
            <DebugBlock
              debug={health.debug ?? undefined}
              diagnosticCode={health.diagnosticCode}
              diagnosticMessage={health.diagnosticMessage}
            />
          )}

          {/* Checked at */}
          <div className="text-[10px] text-muted-foreground text-right">
            Проверено: {new Date(health.checkedAt).toLocaleString("ru")}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OAuth Flow Panel (Tochka Authorization Code flow) ───────────────────────

const OAUTH_STAGE_LABELS: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  not_configured: {
    label: "Не настроено",
    color: "text-gray-500",
    icon: <Settings className="w-3.5 h-3.5" />,
  },
  service_token_ok: {
    label: "Токен сервиса получен",
    color: "text-blue-600",
    icon: <Key className="w-3.5 h-3.5" />,
  },
  consent_pending: {
    label: "Consent создан",
    color: "text-amber-600",
    icon: <Timer className="w-3.5 h-3.5" />,
  },
  awaiting_callback: {
    label: "Ожидаем подтверждения",
    color: "text-amber-600",
    icon: <Timer className="w-3.5 h-3.5 animate-pulse" />,
  },
  token_ok: {
    label: "Авторизован",
    color: "text-green-700",
    icon: <CheckCheck className="w-3.5 h-3.5" />,
  },
};

const OAUTH_STEPS = [
  "service_token_ok",
  "consent_pending",
  "awaiting_callback",
  "token_ok",
];

interface OAuthDebugSnapshot {
  serverGeneratedAuthorizeUrl?: string;
  isServerUrlEnterTochka?: boolean;
  callbackReceived?: boolean;
  codeReceived?: boolean;
  stateMatches?: boolean;
  callbackStateValue?: string;
  callbackCodePreview?: string;
  exchangeStatus?: "pending" | "ok" | "error";
  exchangeResponseBody?: string;
  hybridTokenSaved?: boolean;
  nextStep?: string;
}

function OAuthDebugBlock({
  snap,
  show,
  onToggle,
}: {
  snap: OAuthDebugSnapshot;
  show: boolean;
  onToggle: () => void;
}) {
  const lines: { key: string; value: string; ok?: boolean | null }[] = [
    {
      key: "server_generated_authorize_url",
      value: snap.serverGeneratedAuthorizeUrl ?? "(не запущен)",
      ok: snap.serverGeneratedAuthorizeUrl ? true : null,
    },
    {
      key: "is_server_url_enter_tochka",
      value:
        snap.isServerUrlEnterTochka === undefined
          ? "—"
          : String(snap.isServerUrlEnterTochka),
      ok:
        snap.isServerUrlEnterTochka === true
          ? true
          : snap.isServerUrlEnterTochka === false
            ? false
            : null,
    },
    {
      key: "browser_final_url_after_redirect",
      value: "(в другой вкладке — Tochka 302 redirect, не доступен JS)",
      ok: null,
    },
    {
      key: "callback_received",
      value:
        snap.callbackReceived === undefined
          ? "—"
          : String(snap.callbackReceived),
      ok:
        snap.callbackReceived === true
          ? true
          : snap.callbackReceived === false
            ? false
            : null,
    },
    {
      key: "code_received",
      value:
        snap.codeReceived === undefined
          ? "—"
          : snap.codeReceived
            ? `true (${snap.callbackCodePreview ?? "…"})`
            : "false",
      ok:
        snap.codeReceived === true
          ? true
          : snap.codeReceived === false
            ? false
            : null,
    },
    {
      key: "state_matches",
      value:
        snap.stateMatches === undefined
          ? "—"
          : `${String(snap.stateMatches)}${snap.callbackStateValue ? ` (${snap.callbackStateValue.slice(0, 12)}…)` : ""}`,
      ok:
        snap.stateMatches === true
          ? true
          : snap.stateMatches === false
            ? false
            : null,
    },
    {
      key: "exchange_status",
      value: snap.exchangeStatus ?? "—",
      ok:
        snap.exchangeStatus === "ok"
          ? true
          : snap.exchangeStatus === "error"
            ? false
            : null,
    },
    {
      key: "exchange_response_body",
      value: snap.exchangeResponseBody ?? "—",
      ok: null,
    },
    {
      key: "hybrid_token_saved",
      value:
        snap.hybridTokenSaved === undefined
          ? "—"
          : String(snap.hybridTokenSaved),
      ok:
        snap.hybridTokenSaved === true
          ? true
          : snap.hybridTokenSaved === false
            ? false
            : null,
    },
    {
      key: "next_step",
      value: snap.nextStep ?? "—",
      ok: null,
    },
  ];

  const copyAll = () => {
    const text = lines.map((l) => `${l.key}: ${l.value}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => undefined);
  };

  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Terminal className="w-3 h-3" />
        {show ? "Скрыть" : "OAuth debug"}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${show ? "rotate-180" : ""}`}
        />
      </button>
      {show && (
        <div className="mt-1.5 bg-gray-900 rounded-lg p-3 text-[10px] font-mono space-y-1 relative">
          <button
            onClick={copyAll}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-300 transition-colors"
            title="Копировать"
          >
            <Copy className="w-3 h-3" />
          </button>
          {lines.map(({ key, value, ok }) => (
            <div key={key} className="flex gap-2 leading-relaxed">
              <span className="text-gray-500 shrink-0">{key}:</span>
              <span
                className={`break-all ${ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-gray-300"}`}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OAuthFlowPanel({
  connectorId,
  onDone,
}: {
  connectorId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [manualCode, setManualCode] = useState("");
  const [manualState, setManualState] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSnap, setDebugSnap] = useState<OAuthDebugSnapshot>({});

  const { data: status, refetch: refetchStatus } = useGetTochkaOAuthStatus(
    connectorId,
    {
      query: {
        queryKey: getGetTochkaOAuthStatusQueryKey(connectorId),
        refetchInterval: (query) => {
          const stage = query.state.data?.stage;
          return stage === "awaiting_callback" || stage === "consent_pending"
            ? 3000
            : false;
        },
      },
    },
  );

  const startMutation = useStartTochkaOAuth();
  const submitMutation = useSubmitTochkaOAuthCallback();

  const stage = status?.stage ?? "not_configured";
  const stageInfo =
    OAUTH_STAGE_LABELS[stage] ?? OAUTH_STAGE_LABELS["not_configured"]!;
  const currentStepIdx = OAUTH_STEPS.indexOf(stage);

  const handleStart = async () => {
    setLocalError(null);
    try {
      const result = await startMutation.mutateAsync({ id: connectorId });
      setManualState(result.state ?? "");
      const url = result.authorizeUrl;
      const isEnterTochka = url.startsWith(
        "https://enter.tochka.com/connect/authorize",
      );
      setDebugSnap((prev) => ({
        ...prev,
        serverGeneratedAuthorizeUrl: url,
        isServerUrlEnterTochka: isEnterTochka,
        exchangeStatus: undefined,
        exchangeResponseBody: undefined,
        hybridTokenSaved: false,
        nextStep: isEnterTochka
          ? "URL корректный ✓ — войдите в Точку и подтвердите доступ в открытой вкладке"
          : "ОШИБКА: сервер вернул неверный URL — не enter.tochka.com",
      }));
      setShowDebug(true);
      await refetchStatus();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setLocalError(String(err));
    }
  };

  const handleManualSubmit = async () => {
    if (!manualCode.trim()) return;
    setLocalError(null);
    setDebugSnap((prev) => ({
      ...prev,
      exchangeStatus: "pending",
      exchangeResponseBody: undefined,
    }));
    try {
      const result = await submitMutation.mutateAsync({
        id: connectorId,
        data: { code: manualCode.trim(), state: manualState || undefined },
      });
      setDebugSnap((prev) => ({
        ...prev,
        exchangeStatus: "ok",
        exchangeResponseBody: JSON.stringify(result),
        hybridTokenSaved: true,
        nextStep:
          "Токен получен и сохранён. CustomerCode определяется автоматически.",
      }));
      setLocalSuccess(true);
      await queryClient.invalidateQueries({
        queryKey: getGetBankConnectorsQueryKey(),
      });
      await refetchStatus();
      setTimeout(onDone, 1500);
    } catch (err) {
      setDebugSnap((prev) => ({
        ...prev,
        exchangeStatus: "error",
        exchangeResponseBody: String(err),
        nextStep: "Ошибка обмена кода — см. exchange_response_body",
      }));
      setLocalError(String(err));
    }
  };

  // When server redirects back with ?tochka_oauth=success, detect and refresh
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("tochka_oauth");
    const code = params.get("code");
    const state = params.get("state");
    const isOurConnector = params.get("connector") === connectorId;

    // Detect any callback landing (even error)
    if (oauthResult || code) {
      setDebugSnap((prev) => ({
        ...prev,
        callbackReceived: true,
        codeReceived: !!code,
        callbackCodePreview: code ? code.slice(0, 16) + "…" : undefined,
        stateMatches: state
          ? state ===
            prev.serverGeneratedAuthorizeUrl?.match(/state=([^&]+)/)?.[1]
          : undefined,
        callbackStateValue: state ?? undefined,
        nextStep: code
          ? "Код получен — ожидайте автоматического обмена или введите вручную"
          : "Callback получен без кода — возможна ошибка авторизации",
      }));
    }

    if (oauthResult === "success" && isOurConnector) {
      setDebugSnap((prev) => ({
        ...prev,
        hybridTokenSaved: true,
        exchangeStatus: "ok",
        nextStep: "Токен получен и сохранён. Статус коннектора обновляется.",
      }));
      setLocalSuccess(true);
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      queryClient.invalidateQueries({
        queryKey: getGetBankConnectorsQueryKey(),
      });
      refetchStatus();
      setTimeout(onDone, 1500);
    }
  }, [connectorId, queryClient, refetchStatus, onDone]);

  if (localSuccess || stage === "token_ok") {
    return (
      <div className="border border-green-200 rounded-xl p-4 mt-3 space-y-2.5 bg-green-50/50">
        <div className="flex items-center gap-2">
          <CheckCheck className="w-4 h-4 text-green-600 shrink-0" />
          <div className="text-sm font-semibold text-green-800">
            Авторизация завершена
          </div>
        </div>
        <div className="text-xs text-green-700 leading-relaxed">
          CustomerCode определён автоматически через introspect API и сохранён.
          Синхронизация счетов запущена в фоне — обновите страницу через
          несколько секунд.
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7 border-green-300 text-green-800 hover:bg-green-100"
          onClick={() => {
            refetchStatus();
            onDone();
          }}
        >
          <RefreshCw className="w-3 h-3" />
          Обновить статус
        </Button>
      </div>
    );
  }

  return (
    <div className="border border-amber-200 rounded-xl p-4 mt-3 space-y-4 bg-amber-50/40">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Lock className="w-4 h-4 text-amber-600" />
        Авторизация в Точка Банке
      </div>

      {/* Stage stepper */}
      <div className="flex items-center gap-0.5">
        {OAUTH_STEPS.map((s, i) => {
          const passed = currentStepIdx > i;
          const active = currentStepIdx === i;
          return (
            <div key={s} className="flex items-center flex-1 min-w-0">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                  passed
                    ? "bg-green-500 text-white"
                    : active
                      ? "bg-amber-500 text-white"
                      : "bg-gray-200 text-gray-500"
                }`}
              >
                {passed ? "✓" : i + 1}
              </div>
              {i < OAUTH_STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mx-0.5 ${passed ? "bg-green-400" : "bg-gray-200"}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Current stage description */}
      <div
        className={`flex items-center gap-2 text-xs font-medium ${stageInfo.color}`}
      >
        {stageInfo.icon}
        {stageInfo.label}
        {status?.consentId && (
          <span className="text-gray-400 font-mono ml-1">
            consent: {status.consentId.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* Guidance text by stage */}
      {(stage === "not_configured" || stage === "service_token_ok") && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Нажмите «Начать авторизацию» — система создаст consent в Точке и
          откроет страницу подтверждения в новой вкладке. После подтверждения вы
          будете перенаправлены обратно автоматически.
        </p>
      )}
      {(stage === "consent_pending" || stage === "awaiting_callback") && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <Timer className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-pulse" />
          <div>
            Страница авторизации открыта в новой вкладке. Войдите в Точку и
            подтвердите доступ. После подтверждения страница обновится
            автоматически.
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {(stage === "not_configured" || stage === "service_token_ok") && (
          <Button
            size="sm"
            className="gap-1.5 text-xs h-8"
            onClick={handleStart}
            disabled={startMutation.isPending}
          >
            {startMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ExternalLink className="w-3 h-3" />
            )}
            Начать авторизацию
          </Button>
        )}
        {(stage === "consent_pending" || stage === "awaiting_callback") && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8"
              onClick={handleStart}
              disabled={startMutation.isPending}
            >
              <ExternalLink className="w-3 h-3" />
              Открыть снова
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs h-8 text-muted-foreground"
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? "Скрыть" : "Ввести код вручную"}
            </Button>
          </>
        )}
      </div>

      {/* Manual code input (fallback if redirect doesn't work) */}
      {showManual && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Если автоматический редирект не сработал, скопируйте code= из
            адресной строки:
          </div>
          <div className="flex gap-2">
            <Input
              className="h-7 text-xs font-mono"
              placeholder="code=..."
              value={manualCode}
              onChange={(e) => {
                let v = e.target.value.trim();
                if (v.startsWith("code=")) v = v.slice(5);
                setManualCode(v);
              }}
            />
            <Button
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={handleManualSubmit}
              disabled={submitMutation.isPending || !manualCode.trim()}
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowRight className="w-3 h-3" />
              )}
            </Button>
          </div>
        </div>
      )}

      {localError && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {localError}
        </div>
      )}

      <OAuthDebugBlock
        snap={{
          ...debugSnap,
          hybridTokenSaved: stage === "token_ok" || debugSnap.hybridTokenSaved,
        }}
        show={showDebug}
        onToggle={() => setShowDebug((v) => !v)}
      />
    </div>
  );
}

// ─── Bank connector card ──────────────────────────────────────────────────────

interface ConnectorCardProps {
  bankName: string;
  connector: BankConnectorRow | undefined;
  onConfigure: (c: BankConnectorRow | null, bank: string) => void;
  onSync: (id: string) => void;
  isSyncing: boolean;
  onDelete: (id: string) => void;
}

function ConnectorCard({
  bankName,
  connector,
  onConfigure,
  onSync,
  isSyncing,
  onDelete,
}: ConnectorCardProps) {
  const meta = BANK_META[bankName];
  const status = connector?.connectorStatus ?? "not_configured";
  const isActive = status === "active";
  const isPartial = status === "connected_partial";
  const [showHealth, setShowHealth] = useState(false);
  const [showOAuth, setShowOAuth] = useState(false);
  const isTochka = bankName === "tochka";

  return (
    <Card
      className={`border ${connector ? meta.borderColor : "border-dashed border-gray-200"}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold ${meta.bgColor} ${meta.color}`}
            >
              {meta.label.slice(0, 1)}
            </div>
            <div>
              <div className="font-semibold text-sm">{meta.label}</div>
              <div className="text-xs text-muted-foreground">
                {meta.authType}
              </div>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        {connector ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Последний sync</span>
              <span>{fmtDate(connector.lastSyncAt)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Успех</span>
              <span>{fmtDate(connector.lastSuccessAt)}</span>
            </div>
            {connector.totalBalance !== null &&
              connector.totalBalance !== undefined && (
                <div className="flex justify-between font-medium">
                  <span className="text-xs text-muted-foreground">Остаток</span>
                  <span
                    className={`text-sm ${isActive || isPartial ? "text-green-700" : "text-muted-foreground"}`}
                  >
                    {isActive || isPartial ? fmt(connector.totalBalance) : "—"}
                  </span>
                </div>
              )}
            {/* connected_partial: compact amber warning (accounts+balances OK, transactions not supported) */}
            {isPartial && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded p-1.5 border border-amber-200">
                <Activity className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  Счета и остатки загружены. Операции пока не загружены: нужен
                  endpoint выписок Tochka Statements.
                </span>
              </div>
            )}
            {/* error: show red error banner only for hard errors */}
            {!isPartial && connector.lastError && status === "error" && (
              <div className="text-xs text-red-600 bg-red-50 rounded p-1.5 border border-red-100 break-all">
                {connector.lastError}
              </div>
            )}
            {/* OAuth prompt banner for Tochka when not yet authorized (not shown for partial — already connected) */}
            {isTochka && !isActive && !isPartial && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                Требуется авторизация через Точка Банк
                <Button
                  size="sm"
                  className="ml-auto h-6 text-xs px-2 gap-1 bg-amber-600 hover:bg-amber-700"
                  onClick={() => setShowOAuth((v) => !v)}
                >
                  <Unlock className="w-3 h-3" />
                  {showOAuth ? "Скрыть" : "Авторизовать"}
                </Button>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs gap-1"
                onClick={() => onSync(connector.id)}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Sync
              </Button>
              {isTochka && (isActive || isPartial) && (
                <Button
                  size="sm"
                  variant={showOAuth ? "default" : "outline"}
                  className={`h-7 text-xs gap-1 px-2 ${showOAuth ? "bg-green-600 hover:bg-green-700" : ""}`}
                  onClick={() => setShowOAuth((v) => !v)}
                  title="OAuth статус"
                >
                  <Unlock className="w-3 h-3" />
                </Button>
              )}
              <Button
                size="sm"
                variant={showHealth ? "default" : "outline"}
                className={`flex-1 h-7 text-xs gap-1 ${showHealth ? "bg-primary/90" : ""}`}
                onClick={() => setShowHealth((v) => !v)}
              >
                <Activity className="w-3 h-3" />
                Диагностика
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => onConfigure(connector, bankName)}
              >
                <Settings className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                onClick={() => onDelete(connector.id)}
              >
                <XCircle className="w-3 h-3" />
              </Button>
            </div>

            {showHealth && (
              <ConnectorHealthPanel
                connectorId={connector.id}
                bankName={bankName}
              />
            )}

            {isTochka && showOAuth && (
              <OAuthFlowPanel
                connectorId={connector.id}
                onDone={() => setShowOAuth(false)}
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Подключите {meta.label} для получения live балансов и транзакций
            </p>
            <Button
              size="sm"
              className="w-full h-7 text-xs gap-1.5"
              onClick={() => onConfigure(null, bankName)}
            >
              <Plug className="w-3 h-3" />
              Подключить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Live cash panel ──────────────────────────────────────────────────────────

function LiveCashPanel() {
  const { data: cashflow, isLoading } = useGetBankingCashflow({
    query: {
      queryKey: getGetBankingCashflowQueryKey(),
      refetchInterval: 60000,
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Загрузка данных...
        </CardContent>
      </Card>
    );
  }

  if (!cashflow?.hasLiveData) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <WifiOff className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-muted-foreground">
            Нет live данных
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Подключите хотя бы один банк и выполните sync чтобы увидеть live
            балансы
          </p>
        </CardContent>
      </Card>
    );
  }

  const netPositive = (cashflow.netToday ?? 0) >= 0;

  return (
    <div className="space-y-4">
      {/* Main stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Wifi className="w-3 h-3" /> Общий остаток
            </div>
            <div className="text-xl font-bold text-green-800">
              {fmt(cashflow.totalBalance)}
            </div>
            {cashflow.runwayDays !== null &&
              cashflow.runwayDays !== undefined && (
                <div className="text-xs text-muted-foreground mt-1">
                  Runway: {cashflow.runwayDays} дней
                </div>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3 text-green-600" /> Сегодня
              получено
            </div>
            <div className="text-xl font-bold text-green-700">
              {fmt(cashflow.todayIncome)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <ArrowDownRight className="w-3 h-3 text-red-600" /> Сегодня
              потрачено
            </div>
            <div className="text-xl font-bold text-red-700">
              {fmt(cashflow.todayExpense)}
            </div>
          </CardContent>
        </Card>

        <Card className={netPositive ? "border-green-200" : "border-red-200"}>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              {netPositive ? (
                <TrendingUp className="w-3 h-3 text-green-600" />
              ) : (
                <TrendingDown className="w-3 h-3 text-red-600" />
              )}
              Net за день
            </div>
            <div
              className={`text-xl font-bold ${netPositive ? "text-green-700" : "text-red-700"}`}
            >
              {netPositive ? "+" : ""}
              {fmt(cashflow.netToday)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Среднедневной расход: {fmt(cashflow.avgDailyExpense)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* By bank breakdown */}
      {cashflow.byBank.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Остатки по банкам
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {cashflow.byBank.map((b, i) => {
                const meta = BANK_META[b.bankName ?? ""] ?? {
                  label: b.displayName ?? b.bankName,
                  color: "text-gray-700",
                  bgColor: "bg-gray-100",
                };
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 border-b last:border-0"
                  >
                    <div
                      className={`w-7 h-7 rounded text-xs font-bold flex items-center justify-center ${meta.bgColor} ${meta.color}`}
                    >
                      {meta.label.slice(0, 1)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {b.displayName ?? b.bankName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {b.accountCount} счёт(а)
                      </div>
                    </div>
                    <div className="text-right">
                      {b.connectorStatus === "active" ||
                      b.connectorStatus === "connected_partial" ? (
                        <div className="font-semibold text-sm">
                          {fmt(b.totalBalance)}
                        </div>
                      ) : (
                        <StatusBadge status={b.connectorStatus} />
                      )}
                      {b.lastSyncAt && (
                        <div className="text-[10px] text-muted-foreground">
                          {fmtDate(b.lastSyncAt)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Alerts panel ─────────────────────────────────────────────────────────────

function AlertsPanel() {
  const { data } = useGetBankingAlerts({
    query: { queryKey: getGetBankingAlertsQueryKey(), refetchInterval: 120000 },
  });

  if (!data?.alerts.length) {
    return (
      <Card className="border-green-200 bg-green-50/30">
        <CardContent className="py-4 flex items-center gap-2 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4" />
          Нет активных алертов
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-yellow-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          Алерты
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-[10px]">
            {data.total}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {data.alerts.map((a) => (
          <div
            key={a.id}
            className={`flex items-start gap-2.5 p-2.5 rounded-md border-l-4 ${
              a.severity === "critical"
                ? "bg-red-50 border-l-red-400"
                : "bg-yellow-50 border-l-yellow-400"
            }`}
          >
            <AlertTriangle
              className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${a.severity === "critical" ? "text-red-600" : "text-yellow-600"}`}
            />
            <p className="text-xs leading-snug">{a.message}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Forecast panel ───────────────────────────────────────────────────────────

function ForecastPanel() {
  const { data } = useGetBankingForecast({
    query: {
      queryKey: getGetBankingForecastQueryKey(),
      refetchInterval: 300000,
    },
  });

  if (!data?.hasData) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          <BarChart3 className="w-6 h-6 mx-auto mb-2 opacity-40" />
          Недостаточно данных для прогноза. Нужны live транзакции от банков.
        </CardContent>
      </Card>
    );
  }

  const isPositive = (v: number) => v >= 0;
  const points = [
    { label: "7 дней", value: data.projectedBalance7d },
    { label: "14 дней", value: data.projectedBalance14d },
    { label: "30 дней", value: data.projectedBalance30d },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          Прогноз cashflow
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trend chip */}
        <div
          className={`flex items-center gap-2 text-sm font-medium ${data.burnRateTrend === "positive" ? "text-green-700" : "text-red-700"}`}
        >
          {data.burnRateTrend === "positive" ? (
            <TrendingUp className="w-4 h-4" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          Среднедневной net: {data.avgDailyNet >= 0 ? "+" : ""}
          {fmt(data.avgDailyNet)}/день
        </div>

        {/* Projected balances */}
        <div className="grid grid-cols-3 gap-3">
          {points.map(({ label, value }) => (
            <div
              key={label}
              className={`rounded-md p-3 border text-center ${isPositive(value) ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}`}
            >
              <div className="text-[10px] text-muted-foreground mb-1">
                {label}
              </div>
              <div
                className={`text-sm font-bold ${isPositive(value) ? "text-green-800" : "text-red-800"}`}
              >
                {fmt(value)}
              </div>
            </div>
          ))}
        </div>

        {/* Cash gap */}
        {data.cashGapDate && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Возможное обнуление баланса:{" "}
              <strong>
                {new Date(data.cashGapDate).toLocaleDateString("ru", {
                  day: "2-digit",
                  month: "long",
                })}
              </strong>
            </span>
          </div>
        )}

        {/* Obligations + safe balance */}
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <span className="block">Обязательства/мес</span>
            <span className="text-sm font-medium text-foreground">
              {fmt(data.monthlyObligations)}
            </span>
          </div>
          <div>
            <span className="block">Мин. безопасный остаток</span>
            <span className="text-sm font-medium text-foreground">
              {fmt(data.minimumSafeBalance)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Sync history ─────────────────────────────────────────────────────────────

function SyncHistory() {
  const { data: runs, isLoading } = useGetBankSyncRuns(
    { limit: 20 },
    {
      query: {
        queryKey: getGetBankSyncRunsQueryKey({ limit: 20 }),
        refetchInterval: 30000,
      },
    },
  );

  const statusCls: Record<string, string> = {
    success: "text-green-700 bg-green-100",
    partial: "text-amber-700 bg-amber-100",
    error: "text-red-700 bg-red-100",
    running: "text-blue-700 bg-blue-100",
    skipped: "text-gray-600 bg-gray-100",
  };

  const fmtDur = (ms: number | null | undefined) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}мс`;
    return `${(ms / 1000).toFixed(1)}с`;
  };

  if (isLoading)
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
        Загрузка...
      </div>
    );
  if (!runs?.length)
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Sync-запусков ещё не было
      </div>
    );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Банк</TableHead>
            <TableHead className="w-20">Тип</TableHead>
            <TableHead className="w-28">Время</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead
              className="text-right w-16"
              title="Выписок запрошено / сохранено"
            >
              Выписки
            </TableHead>
            <TableHead className="text-right w-16" title="Транзакций получено">
              Опер.
            </TableHead>
            <TableHead className="text-right w-16" title="Новых транзакций">
              Новых
            </TableHead>
            <TableHead className="text-right w-16" title="Дублей (пропущено)">
              Дубли
            </TableHead>
            <TableHead className="text-right w-16" title="Обновлено балансов">
              Балансы
            </TableHead>
            <TableHead className="text-right w-16" title="Длительность">
              Время
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(runs ?? []).map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-sm font-medium">
                {r.displayName ?? r.bankName ?? "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.runType}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {fmtDate(r.startedAt)}
              </TableCell>
              <TableCell>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusCls[r.status ?? ""] ?? "text-gray-600 bg-gray-100"}`}
                >
                  {r.status}
                </span>
                {r.errorMessage && (
                  <p
                    className="text-[10px] text-red-600 mt-0.5 max-w-[160px] truncate"
                    title={r.errorMessage}
                  >
                    {r.errorMessage}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {r.statementsRequested != null && r.statementsRequested > 0 ? (
                  <span title={`Сохранено: ${r.statementsSaved ?? "?"}`}>
                    {r.statementsRequested}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {r.transactionsReceived ?? "—"}
              </TableCell>
              <TableCell className="text-right text-xs">
                {r.transactionsNew != null ? (
                  <span className="text-green-700 font-medium">
                    +{r.transactionsNew}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right text-xs">
                {r.transactionsDuplicates != null ? (
                  <span className="text-gray-500">
                    {r.transactionsDuplicates}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right text-xs">
                {r.balancesUpdated ?? "—"}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground font-mono">
                {fmtDur(r.durationMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Accounts list (compact) ──────────────────────────────────────────────────

function AccountsList() {
  const { data: accounts, isLoading } = useGetBankAccounts({
    query: { queryKey: getGetBankAccountsQueryKey(), refetchInterval: 60000 },
  });

  if (isLoading)
    return (
      <div className="py-10 text-center text-[14px] text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
        Загрузка счетов…
      </div>
    );
  if (!accounts?.length)
    return (
      <div className="py-14 text-center">
        <CircleDollarSign className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-[15px] font-semibold text-gray-700">Нет счетов</p>
        <p className="text-[13px] text-gray-400 mt-1">
          Подключите банк и запустите sync.
        </p>
      </div>
    );

  const total = accounts.reduce(
    (s, a) => s + (a.currentBalance != null ? parseFloat(a.currentBalance) : 0),
    0,
  );

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[13px] text-gray-500 font-medium">
          {accounts.length} счёт{accounts.length !== 1 ? "а" : ""}
        </span>
        <span className="text-[15px] font-bold text-gray-900">
          Итого: {fmt(total)}
        </span>
      </div>

      {/* Compact list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {accounts.map((a, i) => {
          const bal =
            a.currentBalance != null ? parseFloat(a.currentBalance) : null;
          const avail =
            a.availableBalance != null ? parseFloat(a.availableBalance) : null;
          const r = a as unknown as Record<string, unknown>;
          const masked = r["maskedAccount"] as string | null | undefined;
          const accountStatus = r["accountStatus"] as string | null | undefined;
          const meta = BANK_META[a.bankName ?? ""] ?? {
            label: a.displayName ?? a.bankName ?? "?",
            bgColor: "bg-gray-100",
            color: "text-gray-700",
            borderColor: "border-gray-200",
          };
          const isEnabled = accountStatus?.toLowerCase() === "enabled";
          const balPositive = bal === null || bal >= 0;
          const displayMask =
            masked ??
            (a.accountNumber ? `****${a.accountNumber.slice(-4)}` : "—");
          const syncTime = a.lastBalanceSyncAt
            ? new Date(a.lastBalanceSyncAt).toLocaleTimeString("ru", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : null;

          return (
            <div
              key={a.id}
              className={`flex items-center gap-3 px-4 ${i > 0 ? "border-t border-gray-50" : ""}`}
              style={{ minHeight: 78 }}
            >
              <div
                className={`w-9 h-9 rounded-xl text-[13px] font-bold flex items-center justify-center shrink-0 ${meta.bgColor} ${meta.color}`}
              >
                {meta.label.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-gray-900 font-mono leading-tight">
                  {displayMask}
                </div>
                <div className="text-[12px] text-gray-400 leading-tight mt-0.5">
                  {meta.label} · {a.currency ?? "RUB"}
                  {syncTime ? ` · ${syncTime}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className={`text-[18px] font-bold leading-tight tabular-nums ${balPositive ? "text-gray-900" : "text-red-600"}`}
                >
                  {bal !== null ? fmt(bal) : "—"}
                </div>
                {avail !== null && avail !== bal && (
                  <div className="text-[11px] text-gray-400 leading-tight mt-0.5">
                    доступно: {fmt(avail)}
                  </div>
                )}
                <span
                  className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 ${
                    isEnabled
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {isEnabled ? "Активен" : (accountStatus ?? "—")}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Debounce hook ────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Transaction item type ────────────────────────────────────────────────────

interface TxItem {
  id?: string | null;
  operationDate?: string | null;
  amount?: number | string | null;
  direction?: string | null;
  counterpartyName?: string | null;
  counterpartyInn?: string | null;
  purpose?: string | null;
  maskedAccount?: string | null;
  accountNumber?: string | null;
  externalId?: string | null;
  counterpartyAccount?: string | null;
  operationType?: string | null;
  matchStatus?: string | null;
  bookingDateTime?: string | null;
}

// ─── Transaction detail bottom sheet ─────────────────────────────────────────

type TxSheetAction =
  "match_family" | "match_contractor" | "ignore" | "internal_transfer";
const NO_ARTICLE_SHEET_ACTIONS: TxSheetAction[] = [
  "ignore",
  "internal_transfer",
];

function TxDetailSheet({
  tx,
  open,
  onClose,
  onActionComplete,
}: {
  tx: TxItem | null;
  open: boolean;
  onClose: () => void;
  onActionComplete?: (txId: string) => void;
}) {
  const navigate = useNavigation();
  const qc = useQueryClient();
  const [pendingAction, setPendingAction] = useState<TxSheetAction | null>(
    null,
  );
  const [actingAction, setActingAction] = useState<TxSheetAction | null>(null);

  const matchMutation = useMatchBankingTransaction({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getGetBankingMatchStatsQueryKey(),
        });
        void qc.invalidateQueries({
          queryKey: getGetBankingTransactionsQueryKey(),
        });
      },
    },
  });

  const isIn = tx?.direction === "income";
  const amount = tx?.amount ? parseFloat(String(tx.amount)) : null;
  const account = tx?.maskedAccount ?? tx?.accountNumber ?? "";
  const maskedDisplay =
    account.length >= 4 ? `****${account.slice(-4)}` : account;

  const fields: Array<[string, string | null | undefined]> = tx
    ? [
        ["Счёт", maskedDisplay ? `${maskedDisplay} · Расчётный счёт` : null],
        ["Дата операции", tx.operationDate],
        ["Контрагент", tx.counterpartyName],
        ["ИНН", tx.counterpartyInn],
        ["Р/сч контрагента", tx.counterpartyAccount],
        ["Назначение платежа", tx.purpose],
        ["Тип операции", tx.operationType],
        ["External ID", tx.externalId],
        ["Статус сопоставления", tx.matchStatus],
        ["Источник", "Tochka API"],
      ]
    : [];

  const ACTION_LABELS: Record<TxSheetAction, string> = {
    match_family: "Привязана к семье",
    match_contractor: "Привязана к подрядчику",
    ignore: "Операция проигнорирована",
    internal_transfer: "Помечена как внутренний перевод",
  };

  const executeAction = async (action: TxSheetAction, articleId?: string) => {
    if (!tx?.id) return;
    setActingAction(action);
    try {
      await matchMutation.mutateAsync({
        id: tx.id,
        data: { action, ...(articleId ? { articleId } : {}) },
      });
      toast.success(ACTION_LABELS[action]);
      onActionComplete?.(tx.id);
      onClose();
    } catch {
      toast.error("Ошибка при выполнении действия");
    } finally {
      setActingAction(null);
    }
  };

  const handleActionClick = (action: TxSheetAction) => {
    if (NO_ARTICLE_SHEET_ACTIONS.includes(action)) {
      void executeAction(action);
    } else {
      setPendingAction(action);
    }
  };

  const isActing = actingAction !== null;

  const btnCls = (colorCls: string) =>
    `w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] font-medium text-left transition-colors min-h-[44px] active:opacity-70 disabled:opacity-40 ${colorCls}`;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DrawerContent className="max-h-[92dvh] flex flex-col">
          {tx && (
            <>
              <div className="px-6 pt-1 pb-5 border-b border-gray-100 text-center">
                <div
                  className={`text-[34px] font-bold leading-none mt-2 ${isIn ? "text-green-600" : "text-red-600"}`}
                >
                  {isIn ? "+" : "−"}
                  {amount !== null ? fmt(amount) : "—"}
                </div>
                <div className="text-[13px] text-gray-400 mt-2">
                  {tx.operationDate ?? "—"} · {isIn ? "Поступление" : "Расход"}
                </div>
                {tx.matchStatus && (
                  <span
                    className={`inline-block mt-2 px-3 py-0.5 rounded-full text-[12px] font-medium ${
                      tx.matchStatus === "unmatched"
                        ? "bg-yellow-50 text-yellow-700"
                        : "bg-green-50 text-green-700"
                    }`}
                  >
                    {tx.matchStatus === "unmatched"
                      ? "Не сопоставлено"
                      : tx.matchStatus}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4">
                {/* Details */}
                <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
                  {fields.map(([label, value]) =>
                    value ? (
                      <div key={label} className="flex items-start gap-3">
                        <span className="text-[12px] text-gray-400 w-[120px] shrink-0 pt-0.5">
                          {label}
                        </span>
                        <span className="text-[13px] text-gray-900 font-medium flex-1 break-all">
                          {value}
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>

                {/* Actions */}
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-2 px-1">
                    Действия
                  </p>
                  <div className="space-y-1.5">
                    {/* 1. Сопоставить — opens matching queue */}
                    <button
                      type="button"
                      className={btnCls("bg-violet-50 text-violet-700")}
                      onClick={() => {
                        onClose();
                        navigate("finance-matching");
                      }}
                    >
                      <Link2 className="w-4 h-4 shrink-0" />
                      Сопоставить
                    </button>

                    {/* 2. Выбрать семью / ребёнка */}
                    <button
                      type="button"
                      disabled={isActing}
                      className={btnCls("bg-blue-50 text-blue-700")}
                      onClick={() => handleActionClick("match_family")}
                    >
                      {actingAction === "match_family" ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <Users className="w-4 h-4 shrink-0" />
                      )}
                      Выбрать семью / ребёнка
                    </button>

                    {/* 3. Выбрать договор — uses match_family to link payment to family contract */}
                    <button
                      type="button"
                      disabled={isActing}
                      className={btnCls("bg-blue-50 text-blue-700")}
                      onClick={() => handleActionClick("match_family")}
                    >
                      {actingAction === "match_family" ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4 shrink-0" />
                      )}
                      Выбрать договор
                    </button>

                    {/* 4. Выбрать подрядчика */}
                    <button
                      type="button"
                      disabled={isActing}
                      className={btnCls("bg-blue-50 text-blue-700")}
                      onClick={() => handleActionClick("match_contractor")}
                    >
                      {actingAction === "match_contractor" ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <Briefcase className="w-4 h-4 shrink-0" />
                      )}
                      Выбрать подрядчика
                    </button>

                    {/* 5. Открыть карточку контрагента */}
                    <button
                      type="button"
                      className={btnCls("bg-gray-50 text-gray-700")}
                      onClick={() => {
                        if (tx.counterpartyName) {
                          toast.info(`Контрагент: ${tx.counterpartyName}`, {
                            description: tx.counterpartyInn
                              ? `ИНН ${tx.counterpartyInn}`
                              : undefined,
                          });
                        } else {
                          toast.error("Контрагент не найден в операции");
                        }
                      }}
                    >
                      <Building2 className="w-4 h-4 shrink-0" />
                      Открыть карточку контрагента
                    </button>

                    {/* 6. Создать контрагента */}
                    <button
                      type="button"
                      className={btnCls("bg-gray-50 text-gray-700")}
                      onClick={() =>
                        toast.info(
                          "Создание контрагентов — в следующей версии",
                          {
                            description: tx.counterpartyName
                              ? `Будет предзаполнено: ${tx.counterpartyName}`
                              : undefined,
                          },
                        )
                      }
                    >
                      <UserPlus className="w-4 h-4 shrink-0" />
                      Создать контрагента
                    </button>

                    {/* 7. Игнорировать */}
                    <button
                      type="button"
                      disabled={isActing}
                      className={btnCls("bg-red-50 text-red-600")}
                      onClick={() => handleActionClick("ignore")}
                    >
                      {actingAction === "ignore" ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <Ban className="w-4 h-4 shrink-0" />
                      )}
                      Игнорировать / не учитывать
                    </button>

                    {/* 8. Пометить как внутренний перевод */}
                    <button
                      type="button"
                      disabled={isActing}
                      className={btnCls("bg-orange-50 text-orange-600")}
                      onClick={() => handleActionClick("internal_transfer")}
                    >
                      {actingAction === "internal_transfer" ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <ArrowRight className="w-4 h-4 shrink-0" />
                      )}
                      Пометить как внутренний перевод
                    </button>
                  </div>
                </div>
              </div>

              {/* 9. Закрыть */}
              <div className="px-4 pb-6 pt-3 border-t border-gray-50">
                <DrawerClose asChild>
                  <button
                    type="button"
                    className="w-full h-12 rounded-2xl bg-gray-100 text-gray-700 text-[15px] font-semibold active:bg-gray-200 transition-colors"
                  >
                    Закрыть
                  </button>
                </DrawerClose>
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* Article picker for actions that require a DDS article */}
      <ArticlePickerDialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onSelect={(articleId) => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) void executeAction(action, articleId);
        }}
      />
    </>
  );
}

// ─── Filter bottom sheet ──────────────────────────────────────────────────────

interface FilterValues {
  counterparty: string;
  inn: string;
  purpose: string;
  minAmount: string;
  maxAmount: string;
}

const EMPTY_FILTERS: FilterValues = {
  counterparty: "",
  inn: "",
  purpose: "",
  minAmount: "",
  maxAmount: "",
};

function FilterSheet({
  open,
  onClose,
  filters,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: FilterValues;
  onApply: (f: FilterValues) => void;
}) {
  const [local, setLocal] = useState<FilterValues>(EMPTY_FILTERS);
  useEffect(() => {
    if (open) setLocal(filters);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasActive = Object.values(local).some((v) => v.trim() !== "");

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader className="pb-0">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-[18px] font-bold">Фильтры</DrawerTitle>
            {hasActive && (
              <button
                className="text-[13px] text-violet-600 font-semibold"
                onClick={() => setLocal(EMPTY_FILTERS)}
              >
                Сбросить
              </button>
            )}
          </div>
        </DrawerHeader>
        <div className="px-4 pb-8 pt-4 space-y-3">
          {(
            [
              ["counterparty", "Контрагент", "Название организации…"],
              ["inn", "ИНН", "7802561028…"],
              ["purpose", "Назначение платежа", "Текст назначения…"],
            ] as Array<[keyof FilterValues, string, string]>
          ).map(([key, label, placeholder]) => (
            <div key={key}>
              <label className="text-[12px] text-gray-500 font-semibold mb-1.5 block">
                {label}
              </label>
              <input
                className="w-full h-11 px-4 rounded-xl border border-gray-200 bg-white text-[14px] outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300 transition-colors"
                placeholder={placeholder}
                value={local[key]}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </div>
          ))}
          <div>
            <label className="text-[12px] text-gray-500 font-semibold mb-1.5 block">
              Диапазон суммы
            </label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 h-11 px-4 rounded-xl border border-gray-200 bg-white text-[14px] outline-none focus:ring-1 focus:ring-violet-300 transition-colors"
                placeholder="От ₽"
                type="number"
                value={local.minAmount}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, minAmount: e.target.value }))
                }
              />
              <span className="text-gray-400 shrink-0">—</span>
              <input
                className="flex-1 h-11 px-4 rounded-xl border border-gray-200 bg-white text-[14px] outline-none focus:ring-1 focus:ring-violet-300 transition-colors"
                placeholder="До ₽"
                type="number"
                value={local.maxAmount}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, maxAmount: e.target.value }))
                }
              />
            </div>
          </div>
          <button
            className="w-full h-12 rounded-2xl bg-violet-600 text-white text-[15px] font-bold mt-2 active:bg-violet-700 transition-colors"
            onClick={() => {
              onApply(local);
              onClose();
            }}
          >
            Применить
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─── Counter strip ────────────────────────────────────────────────────────────

function CounterStrip({
  total,
  countIn,
  countOut,
}: {
  total: number;
  countIn: number;
  countOut: number;
}) {
  const now = new Date();
  const updatedStr =
    now.toLocaleDateString("ru", { day: "numeric", month: "short" }) +
    ", " +
    now.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  const cols = [
    { label: "Всего операций", value: fmtNum(total), color: "text-gray-800" },
    { label: "Поступлений", value: fmtNum(countIn), color: "text-green-600" },
    { label: "Расходов", value: fmtNum(countOut), color: "text-red-600" },
    {
      label: "Обновлено",
      value: updatedStr,
      color: "text-gray-600",
      small: true,
    },
  ];
  return (
    <div
      className="flex items-stretch rounded-xl overflow-hidden"
      style={{ background: "#F7F4FF", minHeight: 44 }}
    >
      {cols.map((col, i) => (
        <div
          key={i}
          className="flex-1 flex flex-col items-center justify-center py-1.5 relative"
        >
          {i > 0 && (
            <div className="absolute left-0 top-2 bottom-2 w-px bg-violet-200" />
          )}
          <div
            className={`font-bold leading-tight ${col.small ? "text-[10px]" : "text-[13px]"} ${col.color}`}
          >
            {col.value}
          </div>
          <div className="text-[9px] text-gray-400 mt-0.5 text-center px-0.5 leading-tight">
            {col.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({
  inAmount,
  outAmount,
  netAmount,
  countIn,
  countOut,
}: {
  inAmount: number | null;
  outAmount: number | null;
  netAmount: number | null;
  countIn: number;
  countOut: number;
}) {
  const net = netAmount ?? 0;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <div
        className="rounded-xl p-2.5 flex flex-col gap-0.5"
        style={{ background: "#F0FFF4" }}
      >
        <div className="text-[10px] font-semibold text-green-600">
          Поступления
        </div>
        <div className="font-bold text-green-700 text-[12px] sm:text-[13px] tabular-nums truncate">
          {inAmount !== null ? fmt(inAmount) : "—"}
        </div>
        <div className="text-[10px] text-green-500">
          {fmtNum(countIn)} опер.
        </div>
      </div>
      <div
        className="rounded-xl p-2.5 flex flex-col gap-0.5"
        style={{ background: "#FFF5F5" }}
      >
        <div className="text-[10px] font-semibold text-red-600">Расходы</div>
        <div className="font-bold text-red-700 text-[12px] sm:text-[13px] tabular-nums truncate">
          {outAmount !== null ? fmt(outAmount) : "—"}
        </div>
        <div className="text-[10px] text-red-500">{fmtNum(countOut)} опер.</div>
      </div>
      <div
        className="rounded-xl p-2.5 flex flex-col gap-0.5"
        style={{ background: net >= 0 ? "#F0FFF4" : "#FFF5F5" }}
      >
        <div className="text-[10px] font-semibold text-gray-500">Net</div>
        <div
          className={`font-bold text-[12px] sm:text-[13px] tabular-nums truncate ${net >= 0 ? "text-green-700" : "text-red-700"}`}
        >
          {netAmount !== null ? `${net >= 0 ? "+" : ""}${fmt(netAmount)}` : "—"}
        </div>
        <div className="text-[10px] text-gray-400">итого</div>
      </div>
    </div>
  );
}

// ─── Transaction row (mobile banking style) ───────────────────────────────────

function TxBankRow({ tx, onOpen }: { tx: TxItem; onOpen: () => void }) {
  const isIn = tx.direction === "income";
  const amount = tx.amount ? parseFloat(String(tx.amount)) : null;
  const opDate = tx.operationDate ?? "";
  const d = opDate ? new Date(opDate + "T12:00:00") : null;
  const dateDay = d
    ? d.toLocaleDateString("ru", { day: "numeric", month: "short" })
    : "—";
  const dateYear = d ? String(d.getFullYear()) : "";
  const account = tx.maskedAccount ?? tx.accountNumber ?? "";
  const maskedDisplay =
    account.length >= 4 ? `****${account.slice(-4)}` : account;

  return (
    <div
      className="flex items-center gap-2.5 px-3 border-b border-[#EEF1F5] cursor-pointer active:bg-gray-50/80 transition-colors last:border-b-0"
      style={{ minHeight: 58 }}
      onClick={onOpen}
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isIn ? "bg-green-100" : "bg-red-100"}`}
      >
        {isIn ? (
          <ArrowDownLeft className="w-4 h-4 text-green-600" />
        ) : (
          <ArrowUpRight className="w-4 h-4 text-red-600" />
        )}
      </div>
      <div className="w-[40px] shrink-0">
        <div className="text-[11px] font-medium text-gray-700 leading-tight">
          {dateDay}
        </div>
        <div className="text-[10px] text-gray-400 leading-tight">
          {dateYear}
        </div>
      </div>
      <div className="w-[84px] sm:w-[100px] shrink-0 text-right">
        <div
          className={`text-[13px] font-bold leading-tight tabular-nums ${isIn ? "text-green-600" : "text-red-600"}`}
        >
          {isIn ? "+" : "−"}
          {amount !== null ? fmt(amount) : "—"}
        </div>
        {maskedDisplay && (
          <div className="text-[10px] text-gray-400 font-mono leading-tight">
            {maskedDisplay}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-gray-900 truncate leading-tight">
          {tx.counterpartyName || "Без контрагента"}
        </div>
        <div className="text-[10px] text-gray-400 truncate leading-tight mt-0.5">
          {[tx.counterpartyInn, tx.purpose].filter(Boolean).join(" · ") ||
            "Назначение не указано"}
        </div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
    </div>
  );
}

// ─── Transaction row (desktop table) ─────────────────────────────────────────

function TxDesktopRow({ tx, onOpen }: { tx: TxItem; onOpen: () => void }) {
  const isIn = tx.direction === "income";
  const amount = tx.amount ? parseFloat(String(tx.amount)) : null;
  const account = tx.maskedAccount ?? tx.accountNumber ?? "";
  const maskedDisplay =
    account.length >= 4 ? `****${account.slice(-4)}` : account;

  return (
    <TableRow
      className="cursor-pointer hover:bg-violet-50/30 transition-colors"
      onClick={onOpen}
    >
      <TableCell className="text-[11px] text-gray-500 whitespace-nowrap py-2">
        {tx.operationDate ?? "—"}
      </TableCell>
      <TableCell className="py-2">
        <span
          className={`text-[13px] font-bold whitespace-nowrap tabular-nums ${isIn ? "text-green-600" : "text-red-600"}`}
        >
          {isIn ? "+" : "−"}
          {amount !== null ? fmt(amount) : "—"}
        </span>
      </TableCell>
      <TableCell className="py-2">
        <div className="text-[10px] font-mono text-gray-500">
          {maskedDisplay || "—"}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div className="text-[12px] font-semibold text-gray-900 max-w-[200px] truncate">
          {tx.counterpartyName || "Без контрагента"}
        </div>
        {tx.counterpartyInn && (
          <div className="text-[10px] font-mono text-gray-400">
            {tx.counterpartyInn}
          </div>
        )}
      </TableCell>
      <TableCell className="max-w-[220px] py-2">
        <div className="text-[11px] text-gray-500 truncate">
          {tx.purpose || "Назначение не указано"}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
      </TableCell>
    </TableRow>
  );
}

// ─── Period selector ──────────────────────────────────────────────────────────

type Period = "today" | "7d" | "30d" | "90d" | "month" | "lastmonth" | "custom";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
  { key: "month", label: "Тек. месяц" },
  { key: "lastmonth", label: "Прош. месяц" },
  { key: "custom", label: "Период…" },
];

function getPeriodDates(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: d(7), to: today };
    case "30d":
      return { from: d(30), to: today };
    case "90d":
      return { from: d(90), to: today };
    case "month": {
      const y = now.getFullYear(),
        m = now.getMonth();
      return { from: `${y}-${String(m + 1).padStart(2, "0")}-01`, to: today };
    }
    case "lastmonth": {
      const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        from: d1.toISOString().slice(0, 10),
        to: d2.toISOString().slice(0, 10),
      };
    }
    default:
      return { from: d(30), to: today };
  }
}

interface PeriodSelectorProps {
  period: Period;
  onChange: (period: Period, from: string, to: string) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
}

function PeriodChips({
  period,
  onChange,
  customFrom,
  customTo,
  onCustomChange,
}: PeriodSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              if (key !== "custom") {
                const dates = getPeriodDates(key);
                onChange(key, dates.from, dates.to);
              } else {
                onChange(
                  "custom",
                  customFrom ?? getPeriodDates("30d").from,
                  customTo ?? getPeriodDates("30d").to,
                );
              }
            }}
            className={`shrink-0 px-3 text-[12px] font-medium border transition-colors whitespace-nowrap ${
              period === key
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white border-[#E1E6EF] text-gray-600 hover:border-violet-300 hover:text-violet-700"
            }`}
            style={{ height: 28, borderRadius: 14 }}
          >
            {label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-9 flex-1 text-sm"
            value={customFrom ?? ""}
            onChange={(e) => onCustomChange?.(e.target.value, customTo ?? "")}
          />
          <span className="text-gray-400 text-sm shrink-0">—</span>
          <Input
            type="date"
            className="h-9 flex-1 text-sm"
            value={customTo ?? ""}
            onChange={(e) => onCustomChange?.(customFrom ?? "", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Transactions tab ─────────────────────────────────────────────────────────

interface TransactionsTabProps {
  period: Period;
  customFrom: string;
  customTo: string;
  onPeriodChange: (p: Period, from: string, to: string) => void;
  onCustomChange: (from: string, to: string) => void;
}

function TransactionsTab({
  period,
  customFrom,
  customTo,
  onPeriodChange,
  onCustomChange,
}: TransactionsTabProps) {
  const [dirFilter, setDirFilter] = useState<"" | "income" | "expense">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<FilterValues>(EMPTY_FILTERS);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TxItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [accTxns, setAccTxns] = useState<TxItem[]>([]);
  const PAGE_SIZE = 50;

  const debouncedCounterparty = useDebounce(filterValues.counterparty, 400);
  const debouncedInn = useDebounce(filterValues.inn, 400);
  const debouncedPurpose = useDebounce(filterValues.purpose, 400);

  const dates =
    period === "custom"
      ? { from: customFrom, to: customTo }
      : getPeriodDates(period);

  const statsParams = { from: dates.from, to: dates.to };
  const { data: stats } = useGetBankingTransactionStats(statsParams, {
    query: {
      queryKey: getGetBankingTransactionStatsQueryKey(statsParams),
      refetchInterval: 60000,
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const allTimeParams = { from: "2020-01-01", to: today };
  const { data: allTimeStats } = useGetBankingTransactionStats(allTimeParams, {
    query: {
      queryKey: [
        ...getGetBankingTransactionStatsQueryKey(allTimeParams),
        "alltime",
      ],
      refetchInterval: 120000,
    },
  });
  const hasAnyTransactions = allTimeStats?.hasData ?? false;

  const txParams = {
    from: dates.from,
    to: dates.to,
    ...(dirFilter ? { direction: dirFilter } : {}),
    ...(debouncedCounterparty ? { counterparty: debouncedCounterparty } : {}),
    ...(debouncedPurpose ? { purpose: debouncedPurpose } : {}),
    ...(debouncedInn ? { inn: debouncedInn } : {}),
    limit: PAGE_SIZE,
    offset,
  };
  const { data, isLoading } = useGetBankingTransactions(txParams, {
    query: {
      queryKey: getGetBankingTransactionsQueryKey(txParams),
      refetchInterval: 60000,
    },
  });

  useEffect(() => {
    if (!data?.transactions) return;
    if (offset === 0) {
      setAccTxns(data.transactions as TxItem[]);
    } else {
      setAccTxns((prev) => [...prev, ...(data.transactions as TxItem[])]);
    }
  }, [data, offset]);

  useEffect(() => {
    setOffset(0);
    setAccTxns([]);
  }, [
    period,
    dirFilter,
    debouncedCounterparty,
    debouncedInn,
    debouncedPurpose,
    customFrom,
    customTo,
  ]);

  const total = data?.total ?? 0;
  const hasMore = accTxns.length < total && !isLoading;

  const sq = searchQuery.toLowerCase().trim();
  const visibleTxns = useMemo(
    () =>
      sq
        ? accTxns.filter(
            (tx) =>
              (tx.counterpartyName?.toLowerCase() ?? "").includes(sq) ||
              (tx.counterpartyInn?.toLowerCase() ?? "").includes(sq) ||
              (tx.purpose?.toLowerCase() ?? "").includes(sq),
          )
        : accTxns,
    [accTxns, sq],
  );

  const handleOpenTx = useCallback((tx: TxItem) => {
    setSelectedTx(tx);
    setDetailOpen(true);
  }, []);

  const hasActiveFilters = Object.values(filterValues).some(
    (v) => v.trim() !== "",
  );
  const inAmount =
    stats?.totalIn != null ? parseFloat(String(stats.totalIn)) : null;
  const outAmount =
    stats?.totalOut != null ? parseFloat(String(stats.totalOut)) : null;
  const netAmount = stats?.net != null ? parseFloat(String(stats.net)) : null;

  return (
    <div className="px-3 pb-5 pt-2 space-y-2">
      {/* Period chips */}
      <PeriodChips
        period={period}
        customFrom={customFrom}
        customTo={customTo}
        onChange={onPeriodChange}
        onCustomChange={onCustomChange}
      />

      {/* Summary cards */}
      {stats?.hasData && (
        <SummaryCards
          inAmount={inAmount}
          outAmount={outAmount}
          netAmount={netAmount}
          countIn={stats.countIn ?? 0}
          countOut={stats.countOut ?? 0}
        />
      )}

      {/* Filter row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="flex bg-gray-100 rounded-lg p-0.5 shrink-0">
          {(["", "income", "expense"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={`px-2 sm:px-2.5 py-1 rounded-[8px] text-[11px] font-medium transition-all whitespace-nowrap ${
                dirFilter === d
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {d === "" ? "Все" : d === "income" ? "Приход" : "Расход"}
            </button>
          ))}
        </div>
        <div className="flex-1 relative min-w-[100px]">
          <input
            className="w-full h-8 pl-3 pr-8 rounded-lg border border-gray-200 bg-white text-[12px] placeholder-gray-400 outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300 transition-colors"
            placeholder="Поиск…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
        <button
          onClick={() => setShowFilterSheet(true)}
          className={`flex items-center gap-1 px-2.5 h-8 rounded-lg border text-[11px] font-medium transition-colors shrink-0 ${
            hasActiveFilters
              ? "border-violet-300 text-violet-600 bg-violet-50"
              : "border-gray-200 text-gray-600 bg-white hover:border-gray-300"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Фильтры</span>
          {hasActiveFilters && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
          )}
        </button>
      </div>

      {/* Counter strip */}
      {stats?.hasData && (
        <CounterStrip
          total={total}
          countIn={stats.countIn ?? 0}
          countOut={stats.countOut ?? 0}
        />
      )}

      {/* Transaction list */}
      {isLoading && offset === 0 ? (
        <div className="py-14 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400 mx-auto mb-3" />
          <p className="text-[14px] text-gray-400">Загрузка операций…</p>
        </div>
      ) : !stats?.hasData ? (
        <div className="py-14 text-center">
          <Database className="w-10 h-10 text-gray-200 mx-auto mb-4" />
          {hasAnyTransactions ? (
            <>
              <p className="text-[15px] font-semibold text-gray-700">
                Операций за этот период нет
              </p>
              <p className="text-[13px] text-gray-400 mt-1.5">
                Выберите другой период.
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-gray-700">
                Выписки ещё не загружены
              </p>
              <p className="text-[13px] text-gray-400 mt-1.5">
                Перейдите в «Коннекторы» и запустите Sync.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Mobile: banking-style rows */}
          <div className="md:hidden bg-white rounded-2xl overflow-hidden border border-gray-100">
            {visibleTxns.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-gray-400">
                Нет операций по фильтру
              </div>
            ) : (
              visibleTxns.map((tx) => {
                const key = tx.id ?? tx.externalId ?? String(Math.random());
                return (
                  <TxBankRow
                    key={key}
                    tx={tx}
                    onOpen={() => handleOpenTx(tx)}
                  />
                );
              })
            )}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-2xl border border-gray-100 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
                  <TableHead className="text-xs w-24">Дата</TableHead>
                  <TableHead className="text-xs w-32">Сумма</TableHead>
                  <TableHead className="text-xs w-20">Счёт</TableHead>
                  <TableHead className="text-xs">Контрагент</TableHead>
                  <TableHead className="text-xs max-w-[220px]">
                    Назначение
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTxns.map((tx) => {
                  const key = tx.id ?? tx.externalId ?? String(Math.random());
                  return (
                    <TxDesktopRow
                      key={key}
                      tx={tx}
                      onOpen={() => handleOpenTx(tx)}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="text-center pt-2 pb-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl px-6 h-10 text-[14px]"
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Загрузка…
                  </>
                ) : (
                  `Показать ещё ${Math.min(PAGE_SIZE, total - accTxns.length)}`
                )}
              </Button>
              <div className="text-[12px] text-gray-400 mt-2">
                {fmtNum(accTxns.length)} из {fmtNum(total)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Bottom sheets */}
      <TxDetailSheet
        tx={selectedTx}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onActionComplete={(txId) => {
          setAccTxns((prev) => prev.filter((t) => t.id !== txId));
          setDetailOpen(false);
        }}
      />
      <FilterSheet
        open={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        filters={filterValues}
        onApply={(f) => {
          setFilterValues(f);
          setOffset(0);
          setAccTxns([]);
        }}
      />
    </div>
  );
}

// ─── Article picker dialog ────────────────────────────────────────────────────

function ArticlePickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (articleId?: string) => void;
}) {
  const { data: articles = [] } = useGetArticles();

  const groups = useMemo(() => {
    const map = new Map<string, typeof articles>();
    for (const a of articles) {
      const key =
        ((a as unknown as Record<string, unknown>).groupName as string) ??
        "Прочее";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [articles]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-sm max-h-[78dvh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="text-[15px] font-bold">
            Выберите статью ДДС
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3 min-h-0">
          {Array.from(groups.entries()).map(([group, arts]) => (
            <div key={group}>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1 px-2">
                {group}
              </div>
              <div className="space-y-0.5">
                {arts.map((a) => {
                  const art = a as unknown as Record<string, unknown>;
                  return (
                    <button
                      key={art.id as string}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                      onClick={() => onSelect(art.id as string)}
                    >
                      <span className="text-[11px] font-mono text-gray-400 w-[30px] shrink-0">
                        {art.code as string}
                      </span>
                      <span className="text-[13px] font-medium text-gray-800">
                        {art.name as string}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {articles.length === 0 && (
            <p className="text-[13px] text-gray-400 text-center py-6">
              Нет статей. Сначала добавьте справочник статей.
            </p>
          )}
        </div>
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 shrink-0">
          <button
            className="w-full h-10 rounded-xl bg-gray-100 text-gray-600 text-[13px] font-medium active:bg-gray-200 transition-colors"
            onClick={() => onSelect(undefined)}
          >
            Сопоставить без статьи
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Matching tab ─────────────────────────────────────────────────────────────

const MATCH_QUICK_ACTIONS = [
  {
    action: "match_family",
    label: "Семья",
    Icon: Users,
    cls: "bg-blue-50 text-blue-700 border-blue-100",
  },
  {
    action: "match_contractor",
    label: "Подрядчик",
    Icon: Briefcase,
    cls: "bg-violet-50 text-violet-700 border-violet-100",
  },
  {
    action: "match_employee",
    label: "Сотрудник",
    Icon: Building2,
    cls: "bg-indigo-50 text-indigo-700 border-indigo-100",
  },
  {
    action: "internal_transfer",
    label: "Внутр. перевод",
    Icon: ArrowRight,
    cls: "bg-orange-50 text-orange-700 border-orange-100",
  },
  {
    action: "ignore",
    label: "Игнорировать",
    Icon: Ban,
    cls: "bg-red-50 text-red-600 border-red-100",
  },
] as const;

type QuickMatchAction = (typeof MATCH_QUICK_ACTIONS)[number]["action"];

function MatchStatsRow({ stats }: { stats: BankingMatchStats | undefined }) {
  if (!stats) return null;
  const items = [
    { label: "Всего", value: fmtNum(stats.total), color: "text-gray-800" },
    {
      label: "Не сопост.",
      value: fmtNum(stats.unmatched),
      color: "text-amber-600",
      bg: "#FFF8E7",
    },
    {
      label: "Сопост.",
      value: fmtNum(stats.matched + stats.suggested),
      color: "text-green-700",
      bg: "#F0FFF4",
    },
    { label: "Игнор.", value: fmtNum(stats.ignored), color: "text-gray-500" },
    {
      label: "Внутр.",
      value: fmtNum(stats.internalTransfer),
      color: "text-blue-600",
    },
  ];
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl p-2.5 text-center"
          style={{ background: item.bg ?? "#F7F8FB" }}
        >
          <div className={`text-[15px] font-bold leading-none ${item.color}`}>
            {item.value}
          </div>
          <div className="text-[10px] text-gray-400 mt-1 leading-tight">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReconciliationBtn() {
  const navigate = useNavigation();
  return (
    <button
      onClick={() => navigate("reconciliation")}
      className="flex items-center gap-1 px-2.5 h-7 rounded-lg border border-gray-200 bg-white text-gray-500 hover:border-violet-300 hover:text-violet-700 text-[11px] font-medium transition-colors shrink-0"
    >
      <ArrowLeftRight className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Сверка с банком</span>
    </button>
  );
}

function MatchingTab() {
  const qc = useQueryClient();
  const [selectedTx, setSelectedTx] = useState<TxItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [accTxns, setAccTxns] = useState<TxItem[]>([]);
  const [pendingAction, setPendingAction] = useState<{
    txId: string;
    action: QuickMatchAction;
  } | null>(null);
  const PAGE_SIZE = 50;

  // Load suggestion rules once (cached, staleTime 5 min)
  const { data: rulesData } = useGetCategorizationRules({
    query: {
      queryKey: getGetCategorizationRulesQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });
  const rules = rulesData?.rules ?? [];

  const { data: matchStats } = useGetBankingMatchStats(
    {},
    {
      query: {
        queryKey: getGetBankingMatchStatsQueryKey(),
        refetchInterval: 30000,
      },
    },
  );

  const txParams = { matchStatus: "unmatched", limit: PAGE_SIZE, offset };
  const { data, isLoading } = useGetBankingTransactions(txParams, {
    query: {
      queryKey: getGetBankingTransactionsQueryKey(txParams),
      refetchInterval: 30000,
    },
  });

  const matchMutation = useMatchBankingTransaction({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBankingMatchStatsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankingTransactionsQueryKey() });
      },
    },
  });

  useEffect(() => {
    if (!data?.transactions) return;
    if (offset === 0) setAccTxns(data.transactions as TxItem[]);
    else setAccTxns((prev) => [...prev, ...(data.transactions as TxItem[])]);
  }, [data, offset]);

  const total = data?.total ?? 0;
  const hasMore = accTxns.length < total && !isLoading;

  // Actions that don't need an article (applied immediately)
  const NO_ARTICLE_ACTIONS: QuickMatchAction[] = [
    "ignore",
    "internal_transfer",
  ];

  const handleQuickAction = (txId: string, action: QuickMatchAction) => {
    if (NO_ARTICLE_ACTIONS.includes(action)) {
      matchMutation.mutate({ id: txId, data: { action } });
      setAccTxns((prev) => prev.filter((t) => t.id !== txId));
    } else {
      // Show article picker before firing
      setPendingAction({ txId, action });
    }
  };

  const handleArticleSelected = (articleId?: string) => {
    if (!pendingAction) return;
    const { txId, action } = pendingAction;
    matchMutation.mutate({ id: txId, data: { action, articleId } });
    setAccTxns((prev) => prev.filter((t) => t.id !== txId));
    setPendingAction(null);
  };

  // P3.3: map suggestion engine action → QuickMatchAction understood by PATCH /match
  const SUGGESTION_TO_ACTION: Partial<Record<string, QuickMatchAction>> = {
    contractor: "match_contractor",
    family: "match_family",
    internal_transfer: "internal_transfer",
    ignore: "ignore",
  };

  const handleApplySuggestion = useCallback(
    (txId: string, s: NonNullable<SuggestionResult>) => {
      const action = SUGGESTION_TO_ACTION[s.suggestedAction ?? ""];
      if (!action) return;
      matchMutation.mutate({
        id: txId,
        data: { action, articleId: s.suggestedArticleId ?? undefined },
      });
      setAccTxns((prev) => prev.filter((t) => t.id !== txId));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [matchMutation],
  );

  return (
    <div className="space-y-3">
      {/* Stats */}
      <MatchStatsRow stats={matchStats} />

      {/* Section subheader */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[15px] font-bold text-gray-900">
            Очередь сопоставления
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Только несопоставленные операции · {fmtNum(total)} шт.
          </p>
        </div>
        <ReconciliationBtn />
      </div>

      {/* Transaction list */}
      {isLoading && offset === 0 ? (
        <div className="py-12 text-center">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400 mx-auto mb-3" />
          <p className="text-[13px] text-gray-400">Загрузка очереди…</p>
        </div>
      ) : accTxns.length === 0 ? (
        <div className="py-14 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <p className="text-[16px] font-bold text-gray-700">
            Все операции сопоставлены!
          </p>
          <p className="text-[13px] text-gray-400 mt-1">
            Нет операций, требующих сопоставления.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {accTxns.map((tx) => {
              const isIn = tx.direction === "income";
              const amount = tx.amount ? parseFloat(String(tx.amount)) : null;
              const d = tx.operationDate
                ? new Date(tx.operationDate + "T12:00:00")
                : null;
              const dateStr = d
                ? d.toLocaleDateString("ru", { day: "numeric", month: "short" })
                : "—";
              const suggestion = applyRules(tx, rules);

              return (
                <div
                  key={tx.id ?? tx.externalId}
                  className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden"
                >
                  {/* Transaction info row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer active:bg-gray-50 transition-colors"
                    onClick={() => {
                      setSelectedTx(tx);
                      setDetailOpen(true);
                    }}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isIn ? "bg-green-100" : "bg-red-100"}`}
                    >
                      {isIn ? (
                        <ArrowDownLeft className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                    <div className="w-[42px] shrink-0">
                      <div className="text-[11px] font-medium text-gray-600 leading-tight">
                        {dateStr}
                      </div>
                    </div>
                    <div className="w-[88px] shrink-0 text-right">
                      <div
                        className={`text-[15px] font-bold tabular-nums ${isIn ? "text-green-600" : "text-red-600"}`}
                      >
                        {isIn ? "+" : "−"}
                        {amount !== null ? fmt(amount) : "—"}
                      </div>
                      {tx.maskedAccount && (
                        <div className="text-[10px] text-gray-400 font-mono">
                          {tx.maskedAccount.length >= 4
                            ? `****${tx.maskedAccount.slice(-4)}`
                            : tx.maskedAccount}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">
                        {tx.counterpartyName || "—"}
                      </div>
                      <div className="text-[11px] text-gray-400 truncate mt-0.5">
                        {[tx.counterpartyInn, tx.purpose]
                          .filter(Boolean)
                          .join(" · ") || "\u00A0"}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </div>

                  {/* Suggestion badge + Apply button (P3.3) */}
                  {suggestion && suggestion.confidence >= 80 && (
                    <div className="flex items-center gap-1.5 px-4 pb-2">
                      <Sparkles className="w-3 h-3 text-violet-400 shrink-0" />
                      <span className="text-[11px] text-violet-600 font-medium">
                        {suggestion.suggestedAction === "internal_transfer" &&
                          "Внутренний перевод"}
                        {suggestion.suggestedAction === "ignore" &&
                          "Игнорировать"}
                        {suggestion.suggestedAction === "family" &&
                          "Оплата от семьи"}
                        {suggestion.suggestedAction === "contractor" &&
                          (suggestion.suggestedArticleCode
                            ? `${suggestion.suggestedArticleCode} ${suggestion.suggestedArticleName ?? ""}`
                            : "Подрядчик")}
                        {![
                          "internal_transfer",
                          "ignore",
                          "family",
                          "contractor",
                        ].includes(suggestion.suggestedAction ?? "") &&
                          (suggestion.suggestedArticleName ??
                            suggestion.suggestedAction ??
                            "Предложение")}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {suggestion.confidence}%
                      </span>
                      {SUGGESTION_TO_ACTION[
                        suggestion.suggestedAction ?? ""
                      ] && (
                        <button
                          className="ml-auto flex items-center gap-1 px-2.5 py-[3px] rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-semibold transition-colors hover:bg-violet-100 active:opacity-70 disabled:opacity-40"
                          onClick={() =>
                            tx.id && handleApplySuggestion(tx.id, suggestion)
                          }
                          disabled={matchMutation.isPending}
                        >
                          <CheckCheck className="w-3 h-3 shrink-0" />
                          Применить
                        </button>
                      )}
                    </div>
                  )}

                  {/* Quick action buttons */}
                  <div className="flex items-center gap-1.5 px-3 pb-3 flex-wrap">
                    {MATCH_QUICK_ACTIONS.map(({ action, label, Icon, cls }) => (
                      <button
                        key={action}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors active:opacity-70 ${cls}`}
                        onClick={() =>
                          tx.id && handleQuickAction(tx.id, action)
                        }
                        disabled={matchMutation.isPending}
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="text-center pt-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl px-6 h-10"
                onClick={() => setOffset((p) => p + PAGE_SIZE)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Загрузка…
                  </>
                ) : (
                  `Показать ещё ${Math.min(PAGE_SIZE, total - accTxns.length)}`
                )}
              </Button>
            </div>
          )}
        </>
      )}

      <TxDetailSheet
        tx={selectedTx}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onActionComplete={(txId) => {
          setAccTxns((prev) => prev.filter((t) => t.id !== txId));
          setDetailOpen(false);
        }}
      />
      <ArticlePickerDialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onSelect={handleArticleSelected}
      />
    </div>
  );
}

// ─── Data truth panel ─────────────────────────────────────────────────────────

// ─── DbSourcePanel — блок "Источник данных" ──────────────────────────────────
interface DbAuditResponse {
  environment: "development" | "production";
  isProductionDataSource: boolean;
  databaseFingerprint: string;
  warning: string | null;
  counts: {
    bank_connectors: number;
    bank_accounts: number;
    bank_transactions: number;
    bank_sync_runs: number;
    operations: number;
  };
  maxDates: {
    latestBankTransactionDate: string | null;
    latestBankAccountSyncAt: string | null;
    latestOperationDate: string | null;
    latestSyncRunStartedAt: string | null;
  };
  connectors: Array<{
    bank_name: string;
    status: string;
    last_sync: string | null;
  }>;
}

function DbSourcePanel() {
  const [audit, setAudit] = useState<DbAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/system/db-audit")
      .then((r) => r.json())
      .then((d: DbAuditResponse) => {
        setAudit(d);
        setFetchError(null);
      })
      .catch((e) => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />
        Диагностика источника…
      </div>
    );
  }
  if (fetchError || !audit) {
    return (
      <div className="text-xs text-red-600 px-1">
        Ошибка /api/system/db-audit: {fetchError}
      </div>
    );
  }

  const isProd = audit.isProductionDataSource;
  const lastBankSync = audit.maxDates.latestSyncRunStartedAt
    ? new Date(audit.maxDates.latestSyncRunStartedAt).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const lastLedger = audit.maxDates.latestOperationDate
    ? new Date(audit.maxDates.latestOperationDate).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const lastBankTx = audit.maxDates.latestBankTransactionDate
    ? new Date(audit.maxDates.latestBankTransactionDate).toLocaleDateString(
        "ru-RU",
        { day: "2-digit", month: "2-digit", year: "numeric" },
      )
    : "—";

  return (
    <div className="space-y-3 mt-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Server className="w-3.5 h-3.5" />
        Источник данных
      </h4>

      {/* dev warning banner */}
      {audit.warning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          <span>{audit.warning}</span>
        </div>
      )}

      {/* main grid */}
      <div className="rounded-xl border bg-white overflow-hidden text-xs">
        {[
          {
            label: "Среда",
            value: audit.environment,
            badge: isProd ? (
              <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold text-[10px]">
                production
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-[10px]">
                development
              </span>
            ),
          },
          {
            label: "База",
            value: audit.databaseFingerprint,
            badge: null,
          },
          {
            label: "Счета",
            value: String(audit.counts.bank_accounts),
            badge:
              audit.counts.bank_accounts > 0 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-amber-400" />
              ),
          },
          {
            label: "Банк. операции",
            value: audit.counts.bank_transactions.toLocaleString("ru-RU"),
            badge:
              audit.counts.bank_transactions > 0 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-amber-400" />
              ),
          },
          {
            label: "Ledger (operations)",
            value: audit.counts.operations.toLocaleString("ru-RU"),
            badge:
              audit.counts.operations > 0 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-amber-400" />
              ),
          },
          {
            label: "Последний bank sync",
            value: lastBankSync,
            badge: null,
          },
          {
            label: "Последняя банк. операция",
            value: lastBankTx,
            badge: null,
          },
          {
            label: "Последняя ledger запись",
            value: lastLedger,
            badge: null,
          },
        ].map(({ label, value, badge }, i, arr) => (
          <div
            key={label}
            className={`flex items-center justify-between gap-3 px-3 py-2 ${i < arr.length - 1 ? "border-b border-gray-100" : ""}`}
          >
            <span className="text-muted-foreground shrink-0 w-36">{label}</span>
            <span className="font-mono text-[11px] text-gray-700 truncate text-right">
              {value}
            </span>
            {badge && <span className="shrink-0">{badge}</span>}
          </div>
        ))}
      </div>

      {/* connector statuses */}
      {audit.connectors.length > 0 && (
        <div className="rounded-xl border bg-white overflow-hidden text-xs">
          <div className="px-3 py-1.5 border-b bg-gray-50/60 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Коннекторы
          </div>
          {audit.connectors.map((c, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2 ${i < audit.connectors.length - 1 ? "border-b border-gray-100" : ""}`}
            >
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${c.status === "active" ? "bg-green-500" : "bg-red-400"}`}
              />
              <span className="font-medium">{c.bank_name}</span>
              <span
                className={`ml-auto font-mono text-[10px] ${c.status === "active" ? "text-green-600" : "text-red-500"}`}
              >
                {c.status}
              </span>
              {c.last_sync && (
                <span className="text-muted-foreground text-[10px] shrink-0">
                  {new Date(c.last_sync).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataTruthPanel() {
  const {
    data: truth,
    isLoading,
    refetch,
  } = useGetBankDataTruth({
    query: { queryKey: getGetBankDataTruthQueryKey(), refetchInterval: 30000 },
  });

  if (isLoading) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
        Загрузка...
      </div>
    );
  }

  if (!truth) return null;

  const hasAccounts = truth.accounts.count > 0;
  const hasBalances = (truth.balances.totalBalance ?? 0) > 0;
  const hasTx = truth.transactions.hasData;
  const syncOk = truth.lastSync?.status === "success";
  const syncPartial = truth.lastSync?.status === "partial";

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Счетов загружено",
            value: String(truth.accounts.count),
            ok: hasAccounts,
          },
          {
            label: "Остаток на счетах",
            value: fmt(truth.balances.totalBalance ?? 0),
            ok: hasBalances,
          },
          {
            label: "Операций в базе",
            value: fmtNum(truth.transactions.count),
            ok: hasTx,
          },
          {
            label: "Источник",
            value: truth.source ?? "Tochka API",
            ok: null as boolean | null,
          },
        ].map(({ label, value, ok }) => (
          <Card
            key={label}
            className={
              ok === true
                ? "border-green-200 bg-green-50/30"
                : ok === false
                  ? "border-amber-200 bg-amber-50/30"
                  : ""
            }
          >
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground mb-1">{label}</div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold leading-tight">
                  {value}
                </span>
                {ok === true && (
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                )}
                {ok === false && (
                  <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detailed status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="w-4 h-4" />
            Детали данных
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y text-sm">
          {[
            {
              label: "Счета",
              value: `${truth.accounts.count} счёт(а)`,
              ok: hasAccounts,
              sub: truth.accounts.lastSyncAt
                ? `Синхронизировано ${fmtDate(truth.accounts.lastSyncAt)}`
                : "Не синхронизировано",
            },
            {
              label: "Остатки",
              value: fmt(truth.balances.totalBalance ?? 0),
              ok: hasBalances,
              sub: truth.balances.lastSyncAt
                ? `Синхронизировано ${fmtDate(truth.balances.lastSyncAt)}`
                : "Не синхронизировано",
            },
            {
              label: "Транзакции",
              value: hasTx
                ? `${fmtNum(truth.transactions.count)} операций`
                : "Нет данных",
              ok: hasTx,
              sub:
                hasTx && truth.transactions.from && truth.transactions.to
                  ? `Период: ${truth.transactions.from} — ${truth.transactions.to}   ·   Синхр. ${fmtDate(truth.transactions.lastSyncAt)}`
                  : "Выписки не загружены — выполните sync",
            },
          ].map(({ label, value, ok, sub }) => (
            <div
              key={label}
              className="flex items-start justify-between py-2.5"
            >
              <div>
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {sub}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <span className="text-sm">{value}</span>
                {ok === true && (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                )}
                {ok === false && <XCircle className="w-4 h-4 text-amber-500" />}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Last sync run */}
      {truth.lastSync && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Последний sync-запуск
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded ${syncOk ? "bg-green-100 text-green-800" : syncPartial ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}
              >
                {truth.lastSync.status}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {[
                {
                  label: "Выписок запрошено",
                  value: String(truth.lastSync.statementsRequested ?? "—"),
                },
                {
                  label: "Выписок сохранено",
                  value: String(truth.lastSync.statementsSaved ?? "—"),
                },
                {
                  label: "Новых операций",
                  value: `+${truth.lastSync.transactionsNew ?? 0}`,
                  cls: "text-green-700",
                },
                {
                  label: "Дублей пропущено",
                  value: String(truth.lastSync.transactionsDuplicates ?? 0),
                },
              ].map(({ label, value, cls }) => (
                <div key={label}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={`font-semibold mt-0.5 ${cls ?? ""}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {syncPartial && (
              <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
                <span className="text-base leading-none mt-px">⏳</span>
                <span>
                  <strong>Выписка заказана.</strong> Банк готовит операции — это
                  займёт 1–2 минуты. Повторите Sync через минуту, чтобы забрать
                  готовые данные.
                </span>
              </div>
            )}
            {!syncPartial && truth.lastSync.errorMessage && (
              <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                {truth.lastSync.errorMessage}
              </div>
            )}
            {truth.lastSync.startedAt && (
              <div className="mt-2 text-xs text-muted-foreground flex gap-4">
                <span>Запущен: {fmtDate(truth.lastSync.startedAt)}</span>
                {truth.lastSync.durationMs != null && (
                  <span>
                    Длительность:{" "}
                    {(truth.lastSync.durationMs / 1000).toFixed(1)}с
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Debug counters */}
      {truth.debug && (
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-gray-400 flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              Debug — счётчики sync (сырые данные из базы)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-[11px] text-green-400 font-mono whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(truth.debug, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-3 h-3" />
          Обновить
        </Button>
      </div>
    </div>
  );
}

// ─── DDS Section row ──────────────────────────────────────────────────────────

interface DdsSectionRow {
  direction?: string;
  articleCode?: string | null;
  articleName?: string | null;
  total?: string;
}

function DdsSection({
  title,
  total,
  rows,
  color,
  sign,
}: {
  title: string;
  total: number;
  rows: DdsSectionRow[];
  color: "emerald" | "red";
  sign: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const fmtAmt = (v: number) =>
    v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
  const sorted = [...rows].sort(
    (a, b) => parseFloat(b.total ?? "0") - parseFloat(a.total ?? "0"),
  );
  const ArrowIcon = color === "emerald" ? ArrowDownLeft : ArrowUpRight;
  const iconBg = color === "emerald" ? "bg-emerald-100" : "bg-red-100";
  const iconCl = color === "emerald" ? "text-emerald-600" : "text-red-500";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}
          >
            <ArrowIcon className={`w-3.5 h-3.5 ${iconCl}`} />
          </div>
          <span className="text-[13px] font-bold text-gray-800">{title}</span>
          <span className="text-[11px] text-gray-400">({sorted.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[15px] font-bold tabular-nums ${color === "emerald" ? "text-emerald-600" : "text-red-600"}`}
          >
            {sign}
            {fmtAmt(total)}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        </div>
      </button>
      {expanded && (
        <div>
          {sorted.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-gray-400">
              Нет данных за период
            </p>
          ) : (
            sorted.map((row, i) => {
              const amt = parseFloat(row.total ?? "0");
              const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
              return (
                <div
                  key={i}
                  className="flex items-center px-4 py-2 border-b border-gray-50/80 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-gray-800 leading-tight truncate">
                      {row.articleCode && (
                        <span className="text-gray-300 font-mono text-[11px] mr-1.5">
                          {row.articleCode}
                        </span>
                      )}
                      {row.articleName ?? (
                        <span className="text-gray-400 italic">
                          Без категории
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-2 shrink-0">
                    <span className="text-[11px] text-gray-400 tabular-nums w-8 text-right">
                      {pct}%
                    </span>
                    <span className="text-[13px] font-semibold text-gray-900 tabular-nums w-24 text-right">
                      {fmtAmt(amt)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── LedgerDdsTab ─────────────────────────────────────────────────────────────

type DdsPeriod = "month" | "q" | "half" | "year";

function getDdsPeriodRange(p: DdsPeriod): { from: string; to: string } {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (p === "month") return { from: cur, to: cur };
  const d = new Date(now);
  d.setMonth(
    now.getMonth() - (p === "q" ? 2 : p === "half" ? 5 : now.getMonth()),
  );
  if (p === "year") d.setMonth(0);
  return {
    from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    to: cur,
  };
}

function LedgerDdsTab() {
  const navigate = useNavigation();
  const [period, setPeriod] = useState<DdsPeriod>("month");
  const { from, to } = useMemo(() => getDdsPeriodRange(period), [period]);

  const { data: report, isLoading } = useGetLedgerCashflowReport(
    { from, to },
    {
      query: {
        queryKey: getGetLedgerCashflowReportQueryKey({ from, to }),
        staleTime: 30_000,
      },
    },
  );
  const { data: stats } = useGetLedgerFinancialStats(
    { month: period === "month" ? from : undefined },
    {
      query: {
        queryKey: getGetLedgerFinancialStatsQueryKey({
          month: period === "month" ? from : undefined,
        }),
        staleTime: 30_000,
      },
    },
  );

  const income = useMemo(
    () => (report?.byArticle ?? []).filter((r) => r.direction === "in"),
    [report],
  );
  const expense = useMemo(
    () => (report?.byArticle ?? []).filter((r) => r.direction === "out"),
    [report],
  );
  const totalIn = income.reduce((s, r) => s + parseFloat(r.total ?? "0"), 0);
  const totalOut = expense.reduce((s, r) => s + parseFloat(r.total ?? "0"), 0);
  const net = totalIn - totalOut;
  const fmt = (v: number) =>
    v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";

  if (isLoading)
    return (
      <div className="py-12 flex flex-col items-center gap-2 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Загрузка реестра...</p>
      </div>
    );

  const isEmpty =
    (stats?.totalCount ?? 0) === 0 &&
    income.length === 0 &&
    expense.length === 0;

  return (
    <div className="space-y-3">
      {/* Stats dots — right-aligned, above period chips */}
      {stats && (
        <div className="flex items-center justify-end gap-3">
          <span className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {stats.totalCount} операций
          </span>
          {(stats.unmatchedCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              {stats.unmatchedCount} ожидают
            </span>
          )}
        </div>
      )}

      {/* Period selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(
          [
            ["month", "Этот месяц"],
            ["q", "3 мес"],
            ["half", "6 мес"],
            ["year", "Год"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setPeriod(k)}
            className={`px-3 h-7 text-[12px] rounded-lg font-medium transition-colors ${period === k ? "bg-violet-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {l}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400 self-center font-mono">
          {from}
          {from !== to ? ` — ${to}` : ""}
        </span>
      </div>

      {isEmpty ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-10 text-center">
          <BarChart3 className="w-9 h-9 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">
            Реестр операций пуст
          </p>
          <p className="text-[12px] text-gray-400 mt-1 max-w-64 mx-auto leading-relaxed">
            Сопоставьте банковские транзакции — они автоматически появятся в
            реестре
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 text-xs"
            onClick={() => navigate("finance-matching")}
          >
            Перейти к сопоставлению{" "}
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      ) : (
        <>
          <DdsSection
            title="ПОСТУПЛЕНИЯ"
            total={totalIn}
            rows={income}
            color="emerald"
            sign="+"
          />
          <DdsSection
            title="РАСХОДЫ"
            total={totalOut}
            rows={expense}
            color="red"
            sign="−"
          />
          <div
            className={`rounded-2xl px-5 py-4 flex items-center justify-between ${net >= 0 ? "bg-emerald-50 border border-emerald-100" : "bg-red-50 border border-red-100"}`}
          >
            <div>
              <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                Чистый денежный поток
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                {from}
                {from !== to ? ` — ${to}` : ""}
              </p>
            </div>
            <span
              className={`text-[20px] font-bold tabular-nums ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}
            >
              {net >= 0 ? "+" : ""}
              {fmt(net)}
            </span>
          </div>
          {stats && (
            <p className="text-[11px] text-gray-400 text-right">
              {stats.totalCount} операций · {stats.verifiedCount} проверено
              {(stats.unmatchedCount ?? 0) > 0
                ? ` · ${stats.unmatchedCount} ожидают`
                : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Payables Tab ─────────────────────────────────────────────────────────────

const PAYABLE_STATUS_META: Record<string, { label: string; color: string }> = {
  draft: {
    label: "Черновик",
    color: "bg-gray-100 text-gray-600 border-gray-200",
  },
  pending_review: {
    label: "На проверке",
    color: "bg-amber-50 text-amber-700 border-amber-200",
  },
  approved: {
    label: "Подтверждено",
    color: "bg-blue-50 text-blue-700 border-blue-200",
  },
  scheduled: {
    label: "Запланировано",
    color: "bg-sky-50 text-sky-700 border-sky-200",
  },
  paid: {
    label: "Оплачено",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  cancelled: {
    label: "Отменено",
    color: "bg-red-50 text-red-600 border-red-200",
  },
  overdue: {
    label: "Просрочено",
    color: "bg-red-50 text-red-700 border-red-200",
  },
};

const PAYABLE_SOURCE_LABELS: Record<string, string> = {
  manual: "Ручное",
  email: "Email",
  upload: "Загрузка",
  recurring: "Регулярное",
  api: "API",
};

function fmtRub(v: string | number | null | undefined): string {
  const n = parseFloat(String(v ?? "0"));
  if (isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  });
}

function fmtPayableDate(d: string | null | undefined): string {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split("-");
  return `${dd}.${m}.${y}`;
}

interface PayableCardProps {
  ob: PayableObligation;
  onApprove?: () => void;
  onCancel?: () => void;
  onMarkPaid?: () => void;
  isActing?: boolean;
}

function PayableCard({
  ob,
  onApprove,
  onCancel,
  onMarkPaid,
  isActing,
}: PayableCardProps) {
  const es =
    ((ob as unknown as Record<string, unknown>).effectiveStatus as string) ||
    ob.status;
  const meta = PAYABLE_STATUS_META[es] ??
    PAYABLE_STATUS_META[ob.status] ?? {
      label: ob.status,
      color: "bg-gray-100 text-gray-600",
    };
  const dueDate = ob.dueDate ?? null;
  const isOverdue = es === "overdue";

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 ${isOverdue ? "bg-red-50/30" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[13px] font-semibold text-gray-900 truncate max-w-[200px]">
            {ob.counterpartyName}
          </span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${meta.color}`}
          >
            {meta.label}
          </span>
          {ob.sourceType && ob.sourceType !== "manual" && (
            <span className="text-[10px] text-gray-400">
              {PAYABLE_SOURCE_LABELS[ob.sourceType] ?? ob.sourceType}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          {dueDate && (
            <span className={isOverdue ? "text-red-500 font-medium" : ""}>
              {isOverdue ? "⚠ " : ""}до {fmtPayableDate(dueDate)}
            </span>
          )}
          {ob.documentNumber && <span>№{ob.documentNumber}</span>}
          {ob.description && (
            <span className="truncate max-w-[140px]">{ob.description}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="text-[15px] font-bold text-gray-900 tabular-nums">
          {fmtRub(ob.amountTotal)}
        </span>
        {(onApprove || onCancel || onMarkPaid) && (
          <div className="flex items-center gap-1">
            {onApprove && (
              <button
                type="button"
                disabled={isActing}
                onClick={onApprove}
                className="p-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors disabled:opacity-40"
                title="Подтвердить"
              >
                {isActing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ThumbsUp className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            {onMarkPaid && (
              <button
                type="button"
                disabled={isActing}
                onClick={onMarkPaid}
                className="p-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-40"
                title="Отметить оплаченным"
              >
                {isActing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wallet className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                disabled={isActing}
                onClick={onCancel}
                className="p-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition-colors disabled:opacity-40"
                title="Отменить"
              >
                {isActing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <OctagonX className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface CreatePayableFormState {
  counterpartyName: string;
  amountTotal: string;
  dueDate: string;
  documentNumber: string;
  description: string;
  notes: string;
}

function CreatePayableModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreatePayableFormState>({
    counterpartyName: "",
    amountTotal: "",
    dueDate: "",
    documentNumber: "",
    description: "",
    notes: "",
  });
  const createMut = useCreatePayableObligation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.counterpartyName.trim() || !form.amountTotal) return;
    createMut.mutate(
      {
        data: {
          sourceType: "manual",
          counterpartyName: form.counterpartyName.trim(),
          amountTotal: parseFloat(form.amountTotal),
          dueDate: form.dueDate || undefined,
          documentNumber: form.documentNumber || undefined,
          description: form.description || undefined,
          notes: form.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Обязательство создано");
          onCreated();
          onClose();
        },
        onError: () => toast.error("Ошибка при создании"),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[20px] w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-[15px] font-bold text-gray-900">
            Новое обязательство
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">
              Контрагент *
            </label>
            <input
              className="w-full h-9 px-3 rounded-xl border border-gray-200 text-[13px] focus:outline-none focus:border-violet-400"
              placeholder="Название компании или ИП"
              value={form.counterpartyName}
              onChange={(e) =>
                setForm((s) => ({ ...s, counterpartyName: e.target.value }))
              }
              required
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Сумма, ₽ *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full h-9 px-3 rounded-xl border border-gray-200 text-[13px] focus:outline-none focus:border-violet-400"
                placeholder="0.00"
                value={form.amountTotal}
                onChange={(e) =>
                  setForm((s) => ({ ...s, amountTotal: e.target.value }))
                }
                required
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Срок оплаты
              </label>
              <input
                type="date"
                className="w-full h-9 px-3 rounded-xl border border-gray-200 text-[13px] focus:outline-none focus:border-violet-400"
                value={form.dueDate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, dueDate: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">
              Номер документа
            </label>
            <input
              className="w-full h-9 px-3 rounded-xl border border-gray-200 text-[13px] focus:outline-none focus:border-violet-400"
              placeholder="Счёт / Акт №"
              value={form.documentNumber}
              onChange={(e) =>
                setForm((s) => ({ ...s, documentNumber: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">
              Назначение
            </label>
            <input
              className="w-full h-9 px-3 rounded-xl border border-gray-200 text-[13px] focus:outline-none focus:border-violet-400"
              placeholder="За что платим"
              value={form.description}
              onChange={(e) =>
                setForm((s) => ({ ...s, description: e.target.value }))
              }
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="flex-1 h-10 rounded-xl bg-violet-600 text-white text-[13px] font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {createMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type PayableFilter = "all" | "overdue" | "pending_review" | "approved" | "paid";

function PayablesTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<PayableFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const qKey = getListPayableObligationsQueryKey(
    filter === "all" ? {} : { status: filter },
  );
  const { data: listData, isLoading: loadingList } = useListPayableObligations(
    filter === "all" ? {} : { status: filter },
  );
  const { data: summary, isLoading: loadingSummary } = useGetPayablesSummary();
  const { data: upcoming } = useGetPayablesUpcoming();

  const approveMut = useApprovePayableObligation();
  const cancelMut = useCancelPayableObligation();
  const markPaidMut = useMarkPaidPayableObligation();

  const obligations = (listData?.obligations ?? []) as (PayableObligation & {
    effectiveStatus?: string;
  })[];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListPayableObligationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPayablesSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPayablesUpcomingQueryKey() });
  };

  const handleApprove = (id: string) => {
    setActingId(id);
    approveMut.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Подтверждено");
          invalidate();
        },
        onError: () => toast.error("Ошибка"),
        onSettled: () => setActingId(null),
      },
    );
  };

  const handleCancel = (id: string) => {
    setActingId(id);
    cancelMut.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Отменено");
          invalidate();
        },
        onError: () => toast.error("Ошибка"),
        onSettled: () => setActingId(null),
      },
    );
  };

  const handleMarkPaid = (id: string) => {
    setActingId(id);
    markPaidMut.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Отмечено как оплачено");
          invalidate();
        },
        onError: () => toast.error("Ошибка"),
        onSettled: () => setActingId(null),
      },
    );
  };

  const FILTERS: { key: PayableFilter; label: string; count?: number }[] = [
    { key: "all", label: "Все" },
    { key: "overdue", label: "Просрочено", count: summary?.overdueCount ?? 0 },
    {
      key: "pending_review",
      label: "На проверке",
      count: summary?.pendingReviewCount ?? 0,
    },
    {
      key: "approved",
      label: "Подтверждено",
      count: summary?.approvedCount ?? 0,
    },
    { key: "paid", label: "Оплачено", count: summary?.paidCount ?? 0 },
  ];

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
            К оплате (30 дн.)
          </p>
          {loadingSummary ? (
            <div className="h-5 w-20 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p className="text-[17px] font-bold text-gray-900 tabular-nums">
              {fmtRub(summary?.totalDueNext30Days)}
            </p>
          )}
        </div>
        <div
          className={`bg-white rounded-[14px] border shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-3 py-2.5 ${(summary?.overdueCount ?? 0) > 0 ? "border-red-200 bg-red-50/30" : "border-gray-100"}`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
            Просрочено
          </p>
          {loadingSummary ? (
            <div className="h-5 w-20 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p
              className={`text-[17px] font-bold tabular-nums ${(summary?.overdueCount ?? 0) > 0 ? "text-red-600" : "text-gray-900"}`}
            >
              {fmtRub(summary?.overdueTotal)}
              {(summary?.overdueCount ?? 0) > 0 && (
                <span className="text-[11px] font-normal text-red-400 ml-1">
                  ({summary?.overdueCount})
                </span>
              )}
            </p>
          )}
        </div>
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
            На неделе
          </p>
          {upcoming ? (
            <p className="text-[17px] font-bold text-gray-900 tabular-nums">
              {fmtRub(upcoming.dueThisWeek)}
            </p>
          ) : (
            <div className="h-5 w-20 bg-gray-100 rounded animate-pulse" />
          )}
        </div>
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
            На проверке
          </p>
          {loadingSummary ? (
            <div className="h-5 w-16 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p
              className={`text-[17px] font-bold tabular-nums ${(summary?.pendingReviewCount ?? 0) > 0 ? "text-amber-600" : "text-gray-900"}`}
            >
              {summary?.pendingReviewCount ?? 0}
            </p>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex overflow-x-auto gap-1 flex-1 min-w-0">
          {FILTERS.map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`shrink-0 px-3 h-7 rounded-xl text-[12px] font-semibold border transition-colors ${
                filter === key
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {label}
              {count !== undefined && count > 0 && (
                <span
                  className={`ml-1 ${filter === key ? "text-violet-200" : "text-gray-400"}`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 h-7 px-3 bg-violet-600 text-white rounded-xl text-[12px] font-semibold hover:bg-violet-700 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Добавить
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
        {loadingList ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
          </div>
        ) : obligations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <ClipboardList className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-[14px] font-semibold text-gray-400">
              Нет обязательств
            </p>
            <p className="text-[12px] text-gray-300 mt-1">
              {filter === "all"
                ? "Нажмите «Добавить» чтобы создать первое обязательство"
                : "По выбранному фильтру ничего не найдено"}
            </p>
          </div>
        ) : (
          obligations.map((ob) => {
            const es = ob.effectiveStatus ?? ob.status;
            const canApprove = ![
              "paid",
              "cancelled",
              "approved",
              "scheduled",
            ].includes(es);
            const canMarkPaid = !["paid", "cancelled"].includes(es);
            const canCancel = !["paid", "cancelled"].includes(es);
            return (
              <PayableCard
                key={ob.id}
                ob={ob}
                isActing={actingId === ob.id}
                onApprove={canApprove ? () => handleApprove(ob.id) : undefined}
                onMarkPaid={
                  canMarkPaid ? () => handleMarkPaid(ob.id) : undefined
                }
                onCancel={canCancel ? () => handleCancel(ob.id) : undefined}
              />
            );
          })
        )}
      </div>

      {showCreate && (
        <CreatePayableModal
          onClose={() => setShowCreate(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}

// ─── Recurring Obligations Tab ────────────────────────────────────────────────

const RECURRING_TYPE_LABELS: Record<string, string> = {
  rent: "Аренда",
  payroll: "Зарплата",
  taxes: "Налоги",
  utilities: "Коммунальные",
  telecom: "Телефония",
  software: "ПО/SaaS",
  marketing: "Маркетинг",
  leasing: "Лизинг",
  food: "Питание",
  security: "Охрана",
  infrastructure: "Инфраструктура",
  custom: "Прочее",
};

const RECURRING_TYPE_COLORS: Record<string, string> = {
  rent: "bg-orange-50 text-orange-700 border-orange-200",
  payroll: "bg-blue-50 text-blue-700 border-blue-200",
  taxes: "bg-red-50 text-red-700 border-red-200",
  utilities: "bg-yellow-50 text-yellow-700 border-yellow-200",
  telecom: "bg-cyan-50 text-cyan-700 border-cyan-200",
  software: "bg-purple-50 text-purple-700 border-purple-200",
  marketing: "bg-pink-50 text-pink-700 border-pink-200",
  leasing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  food: "bg-green-50 text-green-700 border-green-200",
  security: "bg-slate-50 text-slate-700 border-slate-200",
  infrastructure: "bg-teal-50 text-teal-700 border-teal-200",
  custom: "bg-gray-50 text-gray-600 border-gray-200",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RECURRING_TYPE_ICONS: Record<string, any> = {
  rent: Building2,
  payroll: Users,
  taxes: Banknote,
  utilities: Zap,
  telecom: Wifi,
  software: Server,
  marketing: Bell,
  leasing: Key,
  food: CircleDollarSign,
  security: ShieldCheck,
  infrastructure: Database,
  custom: CircleDollarSign,
};

function fmtRubles(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, "")} млн ₽`;
  if (n >= 1_000) return `${Math.round(n / 1000)} тыс ₽`;
  return `${Math.round(n)} ₽`;
}

function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d + "T12:00:00Z").toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return d;
  }
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const diff = new Date(d + "T12:00:00Z").getTime() - Date.now();
  return Math.round(diff / 86_400_000);
}

function ConfidencePill({ score }: { score: number | null | undefined }) {
  if (!score) return null;
  const color =
    score >= 90
      ? "text-emerald-700 bg-emerald-50"
      : score >= 75
        ? "text-yellow-700 bg-yellow-50"
        : "text-gray-600 bg-gray-100";
  return (
    <span
      className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${color}`}
    >
      {score}%
    </span>
  );
}

function ObligationCard({
  ob,
  onApprove,
  onReject,
  isPatching,
}: {
  ob: RecurringObligation;
  onApprove?: () => void;
  onReject?: () => void;
  isPatching?: boolean;
}) {
  const typeLabel = RECURRING_TYPE_LABELS[ob.type] ?? ob.type;
  const typeColor =
    RECURRING_TYPE_COLORS[ob.type] ?? RECURRING_TYPE_COLORS.custom;
  const days = daysUntil(ob.nextExpectedDate);

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
      {/* Left: type pill + name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${typeColor}`}
          >
            {typeLabel}
          </span>
          <ConfidencePill score={ob.confidenceScore} />
          {ob.relatedParty && (
            <span className="text-[10px] text-gray-400 italic">связанное</span>
          )}
        </div>
        <p className="text-[13px] font-semibold text-gray-900 truncate">
          {ob.title || ob.counterpartyName || "—"}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {ob.frequency === "monthly"
            ? "ежемесячно"
            : ob.frequency === "quarterly"
              ? "ежеквартально"
              : ob.frequency}
          {ob.counterpartyName && ob.title !== ob.counterpartyName && (
            <span className="ml-1.5 text-gray-300">
              · {ob.counterpartyName.slice(0, 40)}
            </span>
          )}
        </p>
      </div>

      {/* Center: amounts + dates */}
      <div className="text-right shrink-0 min-w-[110px]">
        <p className="text-[14px] font-bold text-gray-900">
          {fmtRubles(ob.expectedAmount)}
        </p>
        {ob.minAmount !== ob.maxAmount && ob.minAmount && ob.maxAmount && (
          <p className="text-[10px] text-gray-400">
            {fmtRubles(ob.minAmount)} – {fmtRubles(ob.maxAmount)}
          </p>
        )}
        <div className="flex items-center justify-end gap-1 mt-1">
          <Clock className="w-3 h-3 text-gray-300 shrink-0" />
          <span
            className={`text-[11px] ${days !== null && days <= 7 ? "text-orange-600 font-semibold" : "text-gray-400"}`}
          >
            {days !== null
              ? days === 0
                ? "сегодня"
                : days < 0
                  ? `${Math.abs(days)} дн назад`
                  : `через ${days} дн`
              : "—"}
          </span>
        </div>
        <p className="text-[10px] text-gray-300">
          прошлая: {fmtShortDate(ob.lastPaidAt)}
        </p>
      </div>

      {/* Right: action buttons (suggested only) */}
      {(onApprove || onReject) && (
        <div className="flex flex-col gap-1 shrink-0">
          <button
            disabled={isPatching}
            onClick={onApprove}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold transition-colors disabled:opacity-40"
          >
            <CheckCircle2 className="w-3 h-3" />
            Да
          </button>
          <button
            disabled={isPatching}
            onClick={onReject}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold transition-colors disabled:opacity-40"
          >
            <XCircle className="w-3 h-3" />
            Нет
          </button>
        </div>
      )}
    </div>
  );
}

function RecurringTab() {
  const qc = useQueryClient();

  const { data: allData, isLoading: loadingAll } = useGetRecurringObligations();
  const { data: upData, isLoading: loadingUp } = useGetRecurringUpcoming();
  const detect = useDetectRecurringObligations();
  const patch = usePatchRecurringObligation();
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const obligations = allData?.obligations ?? [];
  const suggested = obligations
    .filter((o) => o.status === "suggested")
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));
  const approved = obligations
    .filter((o) => o.status === "approved")
    .sort((a, b) =>
      (a.nextExpectedDate ?? "").localeCompare(b.nextExpectedDate ?? ""),
    );
  const upcoming = upData?.upcoming ?? [];

  async function runDetect() {
    await detect.mutateAsync();
    qc.invalidateQueries({ queryKey: getGetRecurringObligationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRecurringUpcomingQueryKey() });
  }

  async function patchStatus(id: string, status: "approved" | "rejected") {
    setPatchingId(id);
    try {
      await patch.mutateAsync({ id, data: { status } });
      qc.invalidateQueries({ queryKey: getGetRecurringObligationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRecurringUpcomingQueryKey() });
    } finally {
      setPatchingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* ── Toolbar in white card ── */}
      <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] flex items-center gap-3 px-4 py-2.5">
        <p className="text-[12px] text-gray-500 flex-1 min-w-0">
          {obligations.length > 0
            ? `${obligations.length} обязательств · ${approved.length} подтв. · ${suggested.length} на проверке`
            : "Регулярные платежи и будущие обязательства"}
        </p>
        <button
          onClick={runDetect}
          disabled={detect.isPending}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 shrink-0"
        >
          {detect.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          Обнаружить
        </button>
      </div>

      {detect.isSuccess && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-[12px] font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Обнаружение завершено: +{(detect.data as any)?.inserted ?? 0} новых,
          обновлено {(detect.data as any)?.updated ?? 0}
        </div>
      )}

      {/* ── Upcoming 30 дней — flat list ── */}
      {(upcoming.length > 0 || loadingUp) && (
        <div>
          {/* Section header */}
          <div className="flex items-center justify-between py-2">
            <span className="text-[13px] font-bold text-gray-900">
              Ближайшие 30 дней
            </span>
            {upData?.totalExpected && (
              <span className="text-[13px] font-bold text-gray-700">
                {fmtRubles(upData.totalExpected)}
              </span>
            )}
          </div>
          {loadingUp ? (
            <div className="flex justify-center py-5">
              <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
            </div>
          ) : (
            <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
              {upcoming.map((ob) => {
                const days = daysUntil(ob.nextExpectedDate);
                const typeLabel = RECURRING_TYPE_LABELS[ob.type] ?? ob.type;
                const typeColor =
                  RECURRING_TYPE_COLORS[ob.type] ??
                  RECURRING_TYPE_COLORS.custom;
                const TypeIcon =
                  RECURRING_TYPE_ICONS[ob.type] ?? CircleDollarSign;
                return (
                  <div
                    key={ob.id}
                    className="flex items-center gap-2.5 px-4 py-2.5 border-b border-gray-50 last:border-0"
                  >
                    <span
                      className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${typeColor}`}
                    >
                      <TypeIcon className="w-2.5 h-2.5 shrink-0" />
                      {typeLabel}
                    </span>
                    <span className="text-[12px] font-medium text-gray-800 truncate flex-1 uppercase tracking-wide">
                      {ob.title || ob.counterpartyName}
                    </span>
                    <span className="text-[12px] font-bold text-gray-900 shrink-0">
                      {fmtRubles(ob.expectedAmount)}
                    </span>
                    <span
                      className={`text-[11px] font-semibold shrink-0 w-12 text-right ${days !== null && days <= 5 ? "text-orange-600" : "text-gray-400"}`}
                    >
                      {fmtShortDate(ob.nextExpectedDate)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Suggested ── */}
      {(suggested.length > 0 || loadingAll) && (
        <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-gray-50">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[13px] font-bold text-gray-900">
              На проверке
            </span>
            {suggested.length > 0 && (
              <span className="ml-auto text-[11px] text-gray-400">
                {suggested.length} — подтвердите или отклоните
              </span>
            )}
          </div>
          {loadingAll ? (
            <div className="flex justify-center py-5">
              <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
            </div>
          ) : (
            <div>
              {suggested.map((ob) => (
                <ObligationCard
                  key={ob.id}
                  ob={ob}
                  isPatching={patchingId === ob.id}
                  onApprove={() => patchStatus(ob.id, "approved")}
                  onReject={() => patchStatus(ob.id, "rejected")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Approved ── */}
      {approved.length > 0 && (
        <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-gray-50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-[13px] font-bold text-gray-900">
              Подтверждённые
            </span>
            <span className="ml-auto text-[11px] text-gray-400">
              {approved.length}
            </span>
          </div>
          <div>
            {approved.map((ob) => (
              <ObligationCard key={ob.id} ob={ob} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loadingAll && obligations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CircleDollarSign className="w-9 h-9 text-gray-200 mb-2.5" />
          <p className="text-[14px] font-semibold text-gray-400">
            Нет обязательств
          </p>
          <p className="text-[12px] text-gray-300 mt-1">
            Нажмите «Обнаружить» — система проанализирует операции
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main BankingPage ─────────────────────────────────────────────────────────

export type BankTab =
  "transactions" | "matching" | "ledger-dds" | "pnl" | "recurring" | "payables";

const SECTION_META: Record<BankTab, { title: string; subtitle: string }> = {
  transactions: {
    title: "Операции",
    subtitle: "Финансовые операции из банка и ручных платежей",
  },
  matching: {
    title: "Сопоставление",
    subtitle: "Классификация и привязка финансовых операций",
  },
  "ledger-dds": {
    title: "ДДС",
    subtitle: "Движение денежных средств по операциям",
  },
  pnl: {
    title: "ОПиУ",
    subtitle: "Отчёт о прибылях и убытках по месяцу начисления",
  },
  recurring: {
    title: "План платежей",
    subtitle: "Регулярные и ожидаемые обязательства",
  },
  payables: {
    title: "Обязательства",
    subtitle: "Входящие счета, акты и исходящие платежи",
  },
};

export function BankingPage({
  activeSection,
}: { activeSection?: BankTab } = {}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<BankTab>("transactions");
  const effectiveTab = activeSection ?? tab;
  const [txPeriod, setTxPeriod] = useState<Period>("30d");
  const [txCustomFrom, setTxCustomFrom] = useState("");
  const [txCustomTo, setTxCustomTo] = useState("");

  const TABS: { key: BankTab; label: string }[] = [
    { key: "transactions", label: "Операции" },
    { key: "matching", label: "Сопоставление" },
    { key: "ledger-dds", label: "ДДС" },
    { key: "pnl", label: "ОПиУ" },
    { key: "recurring", label: "План платежей" },
    { key: "payables", label: "Обязательства" },
  ];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold text-gray-900 leading-tight">
            {SECTION_META[effectiveTab].title}
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {SECTION_META[effectiveTab].subtitle}
          </p>
        </div>
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors shrink-0 mt-0.5"
          onClick={() => qc.invalidateQueries()}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Sub-tabs — only shown in internal mode (no activeSection prop) */}
      {!activeSection && (
        <div className="flex overflow-x-auto border-b border-gray-200 scrollbar-none -mx-0">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`shrink-0 px-4 h-10 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                effectiveTab === key
                  ? "border-violet-600 text-violet-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── PAYABLES ── */}
      {effectiveTab === "payables" && <PayablesTab />}

      {/* ── RECURRING ── */}
      {effectiveTab === "recurring" && <RecurringTab />}

      {/* ── PNL ── */}
      {effectiveTab === "pnl" && <PnlPage embedded />}

      {/* ── MATCHING ── */}
      {effectiveTab === "matching" && <MatchingTab />}

      {/* ── LEDGER DDS ── */}
      {effectiveTab === "ledger-dds" && <LedgerDdsTab />}

      {/* ── TRANSACTIONS ── */}
      {effectiveTab === "transactions" && (
        <div className="bg-white rounded-[18px] border border-gray-100 shadow-[0_1px_8px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-gray-50">
            <div className="flex items-center gap-1.5">
              <List className="w-4 h-4 text-violet-600 shrink-0" />
              <h3 className="text-[14px] font-bold text-gray-900">
                Реестр операций
              </h3>
            </div>
            <div className="flex items-center gap-1 px-2.5 h-7 rounded-xl border border-gray-200 bg-gray-50 text-[12px] text-gray-500 select-none cursor-default">
              <Calendar className="w-3 h-3 text-gray-400 shrink-0" />
              <span>
                {PERIODS.find((p) => p.key === txPeriod)?.label ?? "30 дней"}
              </span>
            </div>
          </div>
          <TransactionsTab
            period={txPeriod}
            customFrom={txCustomFrom}
            customTo={txCustomTo}
            onPeriodChange={(p, from, to) => {
              setTxPeriod(p);
              if (p !== "custom") {
                setTxCustomFrom(from);
                setTxCustomTo(to);
              }
            }}
            onCustomChange={(from, to) => {
              setTxCustomFrom(from);
              setTxCustomTo(to);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Bank Integrations Page (Система → Интеграции · Банки) ───────────────────

type BankIntegTab = "connectors" | "accounts" | "data-truth";

export function BankIntegrationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<BankIntegTab>("connectors");
  const [configTarget, setConfigTarget] = useState<{
    connector: BankConnectorRow | null;
    bank: string;
  } | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [oauthBanner, setOauthBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("tochka_oauth");
    const oauthError = params.get("tochka_error");
    if (oauthResult === "success") {
      setOauthBanner({
        type: "success",
        message:
          "Авторизация в Точка Банке успешно завершена. Коннектор активен.",
      });
      qc.invalidateQueries({ queryKey: getGetBankConnectorsQueryKey() });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauthError) {
      setOauthBanner({
        type: "error",
        message: `Ошибка авторизации: ${decodeURIComponent(oauthError)}`,
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [qc]);

  const { data: connectors, isLoading: connectorsLoading } =
    useGetBankConnectors({
      query: {
        queryKey: getGetBankConnectorsQueryKey(),
        refetchInterval: 30000,
      },
    });

  const deleteConnector = useDeleteBankConnector({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getGetBankConnectorsQueryKey() }),
    },
  });

  const triggerSync = useTriggerBankSync({
    mutation: {
      onSuccess: () => {
        setSyncingId(null);
        qc.invalidateQueries({ queryKey: getGetBankConnectorsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankingCashflowQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBankSyncRunsQueryKey() });
      },
      onError: () => setSyncingId(null),
    },
  });

  const connectorMap = new Map((connectors ?? []).map((c) => [c.bankName, c]));
  const activeCount = (connectors ?? []).filter(
    (c) => c.connectorStatus === "active",
  ).length;

  const handleSync = (id: string) => {
    setSyncingId(id);
    triggerSync.mutate({ id, params: { type: "full" } });
  };

  const handleDelete = (id: string) => {
    if (
      confirm("Удалить коннектор? Аккаунты и история sync будут сохранены.")
    ) {
      deleteConnector.mutate({ id });
    }
  };

  const INTEG_TABS: { key: BankIntegTab; label: string }[] = [
    { key: "connectors", label: "Коннекторы" },
    { key: "accounts", label: "Счета" },
    { key: "data-truth", label: "Статус данных" },
  ];

  return (
    <div className="space-y-6">
      {/* OAuth result banner */}
      {oauthBanner && (
        <div
          className={`flex items-start gap-3 rounded-xl px-4 py-3 border text-sm ${
            oauthBanner.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {oauthBanner.type === "success" ? (
            <CheckCheck className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
          ) : (
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
          )}
          <span className="flex-1">{oauthBanner.message}</span>
          <button
            className="text-xs opacity-60 hover:opacity-100"
            onClick={() => setOauthBanner(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <Plug className="w-6 h-6 text-violet-600 shrink-0" />
            <h2 className="text-[28px] font-bold text-gray-900 leading-tight">
              Интеграции · Банки
            </h2>
          </div>
          <p className="text-[15px] text-gray-500 mt-0.5 leading-snug">
            Технический раздел: подключение банков, счета, синхронизация и
            диагностика.
          </p>
          {activeCount > 0 ? (
            <div
              className="inline-flex items-center gap-1.5 mt-2.5 px-3 rounded-full bg-green-100 text-green-700 text-[13px] font-semibold"
              style={{ height: 28 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {activeCount} активных коннектора
            </div>
          ) : (
            !connectorsLoading && (
              <div
                className="inline-flex items-center gap-1.5 mt-2.5 px-3 rounded-full bg-gray-100 text-gray-500 text-[13px] font-semibold"
                style={{ height: 28 }}
              >
                <WifiOff className="w-3 h-3" />
                Нет активных коннекторов
              </div>
            )
          )}
        </div>
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors shrink-0 mt-1"
          onClick={() => qc.invalidateQueries()}
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Setup required notice */}
      {!connectorsLoading && activeCount === 0 && (
        <Card className="border-dashed border-2 border-blue-200 bg-blue-50/30">
          <CardContent className="py-4 text-center">
            <Plug className="w-6 h-6 text-blue-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-blue-900">
              Требуется настройка коннектора
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Добавьте учётные данные для банка в разделе «Коннекторы» ниже.
              Данные не подменяются.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setTab("connectors")}
            >
              Настроить <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Sub-tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200 scrollbar-none -mx-0">
        {INTEG_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 px-4 h-14 text-[15px] font-medium border-b-[3px] transition-colors whitespace-nowrap ${
              tab === key
                ? "border-violet-600 text-violet-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── CONNECTORS ── */}
      {tab === "connectors" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {["tochka", "tinkoff", "vtb"].map((bank) => (
              <ConnectorCard
                key={bank}
                bankName={bank}
                connector={connectorMap.get(bank)}
                onConfigure={(c, b) =>
                  setConfigTarget({ connector: c, bank: b })
                }
                onSync={handleSync}
                isSyncing={syncingId === connectorMap.get(bank)?.id}
                onDelete={handleDelete}
              />
            ))}
          </div>
          <Card className="bg-muted/30">
            <CardContent className="py-3 px-4 text-xs text-muted-foreground">
              <strong className="text-foreground">Webhook endpoints</strong>{" "}
              (для банков с push-уведомлениями):
              <div className="font-mono mt-1 space-y-0.5">
                {["tochka", "tinkoff", "vtb"].map((b) => (
                  <div key={b}>POST /api/banking/webhooks/{b}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── ACCOUNTS ── */}
      {tab === "accounts" && (
        <div className="px-0">
          <AccountsList />
        </div>
      )}

      {/* ── DATA TRUTH ── */}
      {tab === "data-truth" && (
        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4" />
              Статус данных — что реально загружено
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Точные счётчики из базы данных. Если счётчик 0 — данных нет,
              значения не подставляются.
            </p>
          </div>
          <DataTruthPanel />
          <DbSourcePanel />
        </div>
      )}

      {/* Config dialog */}
      <ConfigDialog
        connector={configTarget?.connector ?? null}
        bankName={configTarget?.bank ?? null}
        open={configTarget !== null}
        onClose={() => setConfigTarget(null)}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: getGetBankConnectorsQueryKey() })
        }
      />
    </div>
  );
}
