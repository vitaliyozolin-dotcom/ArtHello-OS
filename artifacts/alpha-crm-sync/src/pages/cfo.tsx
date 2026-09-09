import { apiFetch } from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Send, Loader2, Zap, AlertTriangle,
  TrendingUp, TrendingDown, RefreshCw, Lightbulb,
  ChevronDown, ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Alert { severity: string; title: string; text: string; icon: string }
interface Insight { title: string; text: string; severity: string; icon: string }
interface FinCtx {
  month: string;
  revenue: number;
  expenses: number;
  grossProfit: number;
  marginPct: string;
  bankBalance: number;
  contractorsDebt: number;
  overdueTaxes: number;
  trustScore: number;
  formatted: { revenue: string; expenses: string; grossProfit: string; bankBalance: string };
}

interface InsightsData {
  month: string;
  context: FinCtx;
  alerts?: Alert[];
  insights?: Insight[];
  recommendations?: Insight[];
  forecast?: Insight;
}

interface ChatMessage { role: "user" | "assistant"; content: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function severityBg(s: string) {
  return s === "high" ? "bg-red-50 border-red-200" : s === "medium" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200";
}

// ─── Context card ─────────────────────────────────────────────────────────────

function ContextCard({ ctx }: { ctx: FinCtx }) {
  const gp = ctx.grossProfit;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: "Выручка", value: ctx.formatted.revenue, color: "text-emerald-600" },
        { label: "Расходы", value: ctx.formatted.expenses, color: "text-red-500" },
        { label: "Вал. прибыль", value: ctx.formatted.grossProfit, color: gp >= 0 ? "text-violet-600" : "text-red-500" },
        { label: "Остаток в банке", value: ctx.formatted.bankBalance, color: "text-blue-600" },
      ].map((item) => (
        <div key={item.label} className="bg-white rounded-[18px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-4">
          <p className="text-[10px] text-gray-400 font-medium">{item.label}</p>
          <p className={`text-lg font-bold leading-tight mt-1 ${item.color}`}>{item.value}</p>
          {item.label === "Вал. прибыль" && (
            <p className="text-[10px] text-gray-400 mt-0.5">маржа: {ctx.marginPct}</p>
          )}
          {item.label === "Остаток в банке" && ctx.trustScore < 80 && (
            <p className="text-[10px] text-amber-500 mt-0.5">Trust: {ctx.trustScore}%</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({ item }: { item: Alert | Insight }) {
  return (
    <div className={`rounded-2xl border p-4 ${severityBg(item.severity)}`}>
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0 leading-none mt-0.5">{item.icon}</span>
        <div>
          <p className="text-sm font-semibold text-gray-800">{item.title}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{item.text}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Section with collapse ─────────────────────────────────────────────────────

function Section({ title, icon, items, defaultOpen = true }: {
  title: string;
  icon: React.ReactNode;
  items: (Alert | Insight)[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items?.length) return null;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 w-full text-left mb-3">
        {icon}
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <span className="text-xs text-gray-400 ml-1">({items.length})</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 ml-auto" />}
      </button>
      {open && (
        <div className="space-y-2">
          {items.map((item, i) => <InsightCard key={i} item={item} />)}
        </div>
      )}
    </div>
  );
}

// ─── Chat bubble ─────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? "bg-violet-600 text-white rounded-tr-sm"
          : "bg-white border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-gray-800 rounded-tl-sm"
      }`}>
        {msg.content}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CfoPage() {
  const [month] = useState(today);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"insights" | "chat">("insights");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: insightsData, isLoading: insightsLoading, refetch, isFetching } = useQuery<InsightsData>({
    queryKey: ["cfo-insights", month],
    queryFn: () =>
      apiFetch("/api/cfo/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      }).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    enabled: false,
  });

  const { data: alerts } = useQuery<{ alerts: Alert[]; month: string }>({
    queryKey: ["cfo-alerts"],
    queryFn: () => apiFetch("/api/cfo/alerts").then((r) => r.json()),
    refetchInterval: 60000,
  });

  const { data: ctx } = useQuery<FinCtx>({
    queryKey: ["cfo-context", month],
    queryFn: () => apiFetch(`/api/cfo/context?month=${month}`).then((r) => r.json()),
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiFetch("/api/cfo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          month,
          history: chatHistory.slice(-10),
        }),
      });
      return res.json() as Promise<{ reply: string }>;
    },
    onSuccess: (data, message) => {
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: data.reply },
      ]);
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  function sendMessage() {
    const msg = input.trim();
    if (!msg || chatMutation.isPending) return;
    setInput("");
    chatMutation.mutate(msg);
  }

  const QUICK_QUESTIONS = [
    "Какой прогноз на следующий месяц?",
    "Где мы теряем деньги?",
    "Что нужно сделать срочно?",
    "Как улучшить маржинальность?",
  ];

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1100px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Финдиректор</h1>
            <p className="text-sm text-gray-400 mt-0.5">GPT-анализ финансов · {month}</p>
          </div>
        </div>
      </div>

      {/* Live alerts strip */}
      {(alerts?.alerts ?? []).length > 0 && (
        <div className="space-y-2">
          {(alerts?.alerts ?? []).map((a, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm ${severityBg(a.severity)}`}>
              <span>{a.icon}</span>
              <strong className="text-gray-800">{a.title}</strong>
              <span className="text-gray-600 flex-1 truncate hidden sm:block">{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Context KPIs */}
      {ctx && <ContextCard ctx={ctx} />}

      {/* Tabs */}
      <div className="flex border-b border-black/[0.06] gap-0">
        {[
          { key: "insights" as const, label: "🧠 Анализ GPT" },
          { key: "chat" as const, label: "💬 Чат с CFO" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
              tab === t.key ? "text-violet-600 border-violet-500" : "text-gray-400 border-transparent hover:text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── INSIGHTS TAB ──────────────────────────────────────────── */}
      {tab === "insights" && (
        <div className="space-y-5">
          {!insightsData && !insightsLoading && (
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-10 flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-3xl bg-violet-50 flex items-center justify-center">
                <Bot className="w-7 h-7 text-violet-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-gray-800">Запустить анализ за {month}</p>
                <p className="text-sm text-gray-400 mt-1 max-w-xs">
                  GPT изучит данные ОПиУ, банк, подрядчиков, налоги и выдаст управленческие инсайты
                </p>
              </div>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-2 px-6 py-3 bg-violet-600 text-white rounded-2xl font-semibold text-sm hover:bg-violet-700 shadow-[0_2px_8px_rgba(124,58,237,0.3)] transition-colors"
              >
                <Zap className="w-4 h-4" />
                Запустить AI-анализ
              </button>
            </div>
          )}

          {(insightsLoading || isFetching) && (
            <div className="bg-white rounded-[22px] border border-black/[0.06] p-10 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
              <p className="text-sm text-gray-500">GPT анализирует данные…</p>
            </div>
          )}

          {insightsData && !insightsLoading && (
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6 space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">Анализ сгенерирован GPT · {month}</p>
                <button onClick={() => refetch()} disabled={isFetching} className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 font-medium">
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
                  Обновить
                </button>
              </div>

              <Section
                title="Предупреждения"
                icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
                items={insightsData.alerts ?? []}
              />
              <Section
                title="Ключевые инсайты"
                icon={<TrendingUp className="w-4 h-4 text-blue-500" />}
                items={insightsData.insights ?? []}
              />
              <Section
                title="Рекомендации"
                icon={<Lightbulb className="w-4 h-4 text-amber-500" />}
                items={insightsData.recommendations ?? []}
                defaultOpen={true}
              />
              {insightsData.forecast && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-violet-500" />
                    Прогноз
                  </p>
                  <InsightCard item={insightsData.forecast} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CHAT TAB ─────────────────────────────────────────────── */}
      {tab === "chat" && (
        <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] flex flex-col" style={{ height: "60vh" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {chatHistory.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <Bot className="w-10 h-10 text-violet-300" />
                <p className="text-sm text-gray-500 max-w-xs">
                  Задайте финансовый вопрос. CFO знает данные ОПиУ, банк, налоги и подрядчиков за {month}.
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {QUICK_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); }}
                      className="text-xs px-3 py-1.5 bg-violet-50 text-violet-700 rounded-xl border border-violet-200 hover:bg-violet-100 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatHistory.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            {chatMutation.isPending && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-white border border-black/[0.06] rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-black/[0.04] p-3 flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Спросите у CFO…"
              rows={1}
              className="flex-1 resize-none text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-300 max-h-32"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || chatMutation.isPending}
              className="w-10 h-10 flex items-center justify-center bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
