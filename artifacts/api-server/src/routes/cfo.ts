import { Router } from "express";
import { eq, desc, sql, sum, count, and, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  operations,
  articles,
  contractorsTable,
  contractorAccrualsTable,
  contractorPaymentsTable,
  taxObligationsTable,
  bankAccountsTable,
  staffPayoutsTable,
} from "@workspace/db";
import OpenAI from "openai";

export const cfoRouter = Router();

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "none",
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

// ─── Context aggregator ───────────────────────────────────────────────────────

async function buildFinancialContext(month: string) {
  const today = new Date().toISOString().slice(0, 10);
  const prevMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();

  // Current month P&L
  const [income] = await db
    .select({ total: sql<string>`coalesce(sum(amount::numeric),0)` })
    .from(operations)
    .where(and(eq(operations.plMonth, month), eq(operations.direction, "in")));

  const [expense] = await db
    .select({ total: sql<string>`coalesce(sum(amount::numeric),0)` })
    .from(operations)
    .where(and(eq(operations.plMonth, month), eq(operations.direction, "out")));

  // Previous month P&L
  const [prevIncome] = await db
    .select({ total: sql<string>`coalesce(sum(amount::numeric),0)` })
    .from(operations)
    .where(
      and(eq(operations.plMonth, prevMonth), eq(operations.direction, "in")),
    );

  const [prevExpense] = await db
    .select({ total: sql<string>`coalesce(sum(amount::numeric),0)` })
    .from(operations)
    .where(
      and(eq(operations.plMonth, prevMonth), eq(operations.direction, "out")),
    );

  // Bank balance
  const [bankBalance] = await db
    .select({ total: sql<string>`coalesce(sum(current_balance::numeric),0)` })
    .from(bankAccountsTable);

  // Contractors debt
  const [accruals] = await db
    .select({ total: sql<string>`coalesce(sum(amount::numeric),0)` })
    .from(contractorAccrualsTable);

  const [paid] = await db
    .select({ total: sql<string>`coalesce(sum(amount::numeric),0)` })
    .from(contractorPaymentsTable);

  // Overdue taxes
  const overdueTaxes = await db
    .select()
    .from(taxObligationsTable)
    .where(and(sql`status != 'paid'`, lte(taxObligationsTable.dueDate, today)))
    .limit(5);

  // Trust score this month
  const [totalOps] = await db
    .select({ cnt: count(operations.id) })
    .from(operations)
    .where(and(eq(operations.plMonth, month), sql`direction IN ('in','out')`));

  const [unverified] = await db
    .select({ cnt: count(operations.id) })
    .from(operations)
    .where(
      and(
        eq(operations.plMonth, month),
        eq(operations.verificationStatus, "unverified"),
        sql`direction IN ('in','out')`,
      ),
    );

  const [noArticle] = await db
    .select({ cnt: count(operations.id) })
    .from(operations)
    .where(
      and(
        eq(operations.plMonth, month),
        sql`article_id IS NULL AND direction IN ('in','out')`,
      ),
    );

  const rev = parseFloat(String(income?.total ?? "0"));
  const exp = parseFloat(String(expense?.total ?? "0"));
  const prevRev = parseFloat(String(prevIncome?.total ?? "0"));
  const prevExp = parseFloat(String(prevExpense?.total ?? "0"));
  const totalOpsN = Number(totalOps?.cnt ?? 0);
  const trustScore =
    totalOpsN > 0
      ? Math.max(
          0,
          Math.round(
            100 -
              (Number(unverified?.cnt ?? 0) / totalOpsN) * 40 -
              (Number(noArticle?.cnt ?? 0) / totalOpsN) * 40,
          ),
        )
      : 100;

  const fmt = (n: number) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(n);

  return {
    month,
    prevMonth,
    revenue: rev,
    expenses: exp,
    grossProfit: rev - exp,
    margin: rev > 0 ? rev - exp : 0,
    marginPct: rev > 0 ? (((rev - exp) / rev) * 100).toFixed(1) + "%" : "n/a",
    prevRevenue: prevRev,
    prevExpenses: prevExp,
    prevGrossProfit: prevRev - prevExp,
    revenueGrowth:
      prevRev > 0
        ? (((rev - prevRev) / prevRev) * 100).toFixed(1) + "%"
        : "n/a",
    bankBalance: parseFloat(String(bankBalance?.total ?? "0")),
    contractorsDebt: Math.max(
      0,
      parseFloat(String(accruals?.total ?? "0")) -
        parseFloat(String(paid?.total ?? "0")),
    ),
    overdueTaxes: overdueTaxes.length,
    overdueAmount: overdueTaxes.reduce(
      (s, t) => s + parseFloat(String(t.accruedAmount)),
      0,
    ),
    trustScore,
    unverifiedOps: Number(unverified?.cnt ?? 0),
    noArticleOps: Number(noArticle?.cnt ?? 0),
    totalOps: totalOpsN,
    formatted: {
      revenue: fmt(rev),
      expenses: fmt(exp),
      grossProfit: fmt(rev - exp),
      bankBalance: fmt(parseFloat(String(bankBalance?.total ?? "0"))),
    },
  };
}

// ─── GET /cfo/context ─────────────────────────────────────────────────────────

cfoRouter.get("/cfo/context", async (req, res) => {
  try {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const ctx = await buildFinancialContext(
      (req.query.month as string) ?? month,
    );
    res.json(ctx);
  } catch (err) {
    req.log.error({ err }, "GET /cfo/context failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /cfo/insights ───────────────────────────────────────────────────────
// Generate AI insights for a given month

cfoRouter.post("/cfo/insights", async (req, res) => {
  try {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const month = (req.body?.month as string) ?? defaultMonth;

    const ctx = await buildFinancialContext(month);
    const openai = getOpenAI();

    const systemPrompt = `Ты — CFO AI (финансовый директор) образовательного бизнеса ArtHello.
Ты говоришь на русском языке. Отвечаешь кратко, конкретно, с цифрами.
Твоя роль — давать краткие управленческие инсайты и предупреждения на основе финансовых данных.
Структурируй ответ как JSON с полями: alerts (массив срочных предупреждений), insights (массив ключевых наблюдений), recommendations (массив конкретных рекомендаций), forecast (краткий прогноз).
Каждый элемент должен иметь: title, text, severity ("high"|"medium"|"low"), icon ("🔴"|"🟡"|"🟢"|"📊"|"💡"|"⚠️").`;

    const userPrompt = `Анализ за ${month}:
- Выручка: ${ctx.formatted.revenue} (прошлый месяц: ${new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(ctx.prevRevenue)}, рост: ${ctx.revenueGrowth})
- Расходы: ${ctx.formatted.expenses}
- Валовая прибыль: ${ctx.formatted.grossProfit} (маржа: ${ctx.marginPct})
- Остаток на счетах: ${ctx.formatted.bankBalance}
- Долг перед подрядчиками: ${new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(ctx.contractorsDebt)}
- Просроченные налоги: ${ctx.overdueTaxes} обязательств на ${new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(ctx.overdueAmount)}
- Trust Score данных: ${ctx.trustScore}% (${ctx.unverifiedOps} непроверенных, ${ctx.noArticleOps} без статьи из ${ctx.totalOps} операций)

Дай управленческий анализ с конкретными советами.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { insights: [], alerts: [], recommendations: [] };
    }

    res.json({ month, context: ctx, ...parsed });
  } catch (err) {
    req.log.error({ err }, "POST /cfo/insights failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /cfo/chat ───────────────────────────────────────────────────────────
// Free-form Q&A with financial context injected

cfoRouter.post("/cfo/chat", async (req, res) => {
  try {
    const {
      message,
      month,
      history = [],
    } = req.body as {
      message: string;
      month?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message required" });
      return;
    }

    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const ctxMonth = month ?? defaultMonth;
    const ctx = await buildFinancialContext(ctxMonth);

    const openai = getOpenAI();

    const systemContent = `Ты — AI финансовый директор (CFO) образовательной компании ArtHello.
Говоришь на русском языке, кратко, по делу, с цифрами когда нужно.
Текущие финансовые данные (${ctxMonth}):
- Выручка: ${ctx.formatted.revenue}, Расходы: ${ctx.formatted.expenses}, Валовая прибыль: ${ctx.formatted.grossProfit}
- Маржинальность: ${ctx.marginPct}
- Остаток на счетах: ${ctx.formatted.bankBalance}
- Долг подрядчикам: ${new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(ctx.contractorsDebt)}
- Просрочено налогов: ${ctx.overdueTaxes} обязательств
- Trust Score данных: ${ctx.trustScore}%
Рост выручки vs прошлый месяц: ${ctx.revenueGrowth}
Отвечай как опытный CFO, который хорошо знает этот бизнес.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      ...history.slice(-10),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages,
      temperature: 0.5,
      max_tokens: 800,
    });

    const reply =
      completion.choices[0]?.message?.content ?? "Не могу ответить сейчас.";
    res.json({ reply, month: ctxMonth });
  } catch (err) {
    req.log.error({ err }, "POST /cfo/chat failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /cfo/alerts ─────────────────────────────────────────────────────────
// Fast rule-based alerts (no AI, instant)

cfoRouter.get("/cfo/alerts", async (req, res) => {
  try {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const ctx = await buildFinancialContext(month);

    const alerts: {
      severity: string;
      title: string;
      text: string;
      icon: string;
    }[] = [];

    if (ctx.overdueAmount > 0) {
      alerts.push({
        severity: "high",
        icon: "🔴",
        title: "Просроченные налоги",
        text: `${ctx.overdueTaxes} налоговых обязательств просрочено на сумму ${ctx.formatted.bankBalance}. Срочно требуется оплата.`,
      });
    }

    if (ctx.contractorsDebt > 200000) {
      alerts.push({
        severity: "medium",
        icon: "🟡",
        title: "Задолженность подрядчикам",
        text: `Долг перед подрядчиками: ${new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(ctx.contractorsDebt)}. Проверьте акты.`,
      });
    }

    if (ctx.trustScore < 70) {
      alerts.push({
        severity: "medium",
        icon: "⚠️",
        title: "Низкое качество данных",
        text: `Trust Score ${ctx.trustScore}%. ${ctx.noArticleOps} операций без статьи, ${ctx.unverifiedOps} непроверенных.`,
      });
    }

    if (ctx.grossProfit < 0) {
      alerts.push({
        severity: "high",
        icon: "🔴",
        title: "Убыток за месяц",
        text: `Валовая прибыль отрицательная: ${ctx.formatted.grossProfit}. Расходы превышают доходы.`,
      });
    }

    if (ctx.bankBalance < 300000) {
      alerts.push({
        severity: "high",
        icon: "🔴",
        title: "Низкий остаток на счетах",
        text: `Остаток ${ctx.formatted.bankBalance} — критически мало. Runway менее 1 месяца.`,
      });
    }

    res.json({
      month,
      alerts,
      context: {
        trustScore: ctx.trustScore,
        grossProfit: ctx.grossProfit,
        bankBalance: ctx.bankBalance,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /cfo/alerts failed");
    res.status(500).json({ error: "Internal error" });
  }
});
