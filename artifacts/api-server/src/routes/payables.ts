import { Router } from "express";
import { pool } from "@workspace/db";

export const payablesRouter = Router();

const today = () => new Date().toISOString().slice(0, 10);

function effectiveStatus(row: Record<string, unknown>): string {
  if (row.status === "paid" || row.status === "cancelled") return row.status as string;
  if (row.due_date && String(row.due_date).slice(0, 10) < today()) return "overdue";
  return row.status as string;
}

// ─── GET /api/payables/obligations ────────────────────────────────────────────

payablesRouter.get("/payables/obligations", async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, counterparty, dueFrom, dueTo, sourceType } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status && status !== "overdue") {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (counterparty) {
      conditions.push(`counterparty_name ILIKE $${idx++}`);
      params.push(`%${counterparty}%`);
    }
    if (dueFrom) {
      conditions.push(`due_date >= $${idx++}`);
      params.push(dueFrom);
    }
    if (dueTo) {
      conditions.push(`due_date <= $${idx++}`);
      params.push(dueTo);
    }
    if (sourceType) {
      conditions.push(`source_type = $${idx++}`);
      params.push(sourceType);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await client.query(
      `SELECT * FROM payable_obligations ${where} ORDER BY due_date ASC NULLS LAST, created_at DESC`,
      params,
    );

    const obligations = rows.map((r) => ({ ...r, effectiveStatus: effectiveStatus(r) }));

    if (status === "overdue") {
      res.json({ obligations: obligations.filter((o) => o.effectiveStatus === "overdue") });
    } else {
      res.json({ obligations });
    }
  } catch (err) {
    req.log.error({ err }, "payables: list failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── POST /api/payables/obligations ───────────────────────────────────────────

payablesRouter.post("/payables/obligations", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      sourceType, counterpartyName, documentNumber, documentDate,
      dueDate, servicePeriodFrom, servicePeriodTo,
      amountTotal, amountVat, currency,
      ddsArticleId, opiuArticleId, relatedRecurringId,
      branchId, description, notes,
      isRecurringCandidate, isIntercompany,
    } = req.body as Record<string, unknown>;

    if (!sourceType || !counterpartyName || amountTotal === undefined) {
      res.status(400).json({ error: "sourceType, counterpartyName, amountTotal are required" });
      return;
    }

    let finalCounterparty = counterpartyName as string;
    let finalAmount = amountTotal;
    if (relatedRecurringId) {
      const { rows } = await client.query(
        `SELECT counterparty_name, expected_amount FROM recurring_obligations WHERE id = $1`,
        [relatedRecurringId],
      );
      if (rows[0]) {
        finalCounterparty = (counterpartyName as string) || rows[0].counterparty_name || finalCounterparty;
        if (!amountTotal) finalAmount = rows[0].expected_amount;
      }
    }

    const { rows } = await client.query(
      `INSERT INTO payable_obligations (
        source_type, status, counterparty_name,
        document_number, document_date, due_date,
        service_period_from, service_period_to,
        amount_total, amount_vat, currency,
        dds_article_id, opiu_article_id, related_recurring_id,
        branch_id, description, notes,
        is_recurring_candidate, is_intercompany,
        created_at, updated_at
      ) VALUES (
        $1, 'draft', $2,
        $3, $4, $5,
        $6, $7,
        $8, $9, $10,
        $11, $12, $13,
        $14, $15, $16,
        $17, $18,
        NOW(), NOW()
      ) RETURNING *`,
      [
        sourceType, finalCounterparty,
        documentNumber ?? null, documentDate ?? null, dueDate ?? null,
        servicePeriodFrom ?? null, servicePeriodTo ?? null,
        finalAmount, amountVat ?? null, (currency as string) || "RUB",
        ddsArticleId ?? null, opiuArticleId ?? null, relatedRecurringId ?? null,
        branchId ?? null, description ?? null, notes ?? null,
        isRecurringCandidate ?? false, isIntercompany ?? false,
      ],
    );

    res.status(201).json({ obligation: { ...rows[0], effectiveStatus: effectiveStatus(rows[0]) } });
  } catch (err) {
    req.log.error({ err }, "payables: create failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/payables/obligations/:id ──────────────────────────────────────

payablesRouter.patch("/payables/obligations/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const allowed = [
      "counterparty_name", "document_number", "document_date", "due_date",
      "service_period_from", "service_period_to", "amount_total", "amount_vat",
      "currency", "dds_article_id", "opiu_article_id", "related_recurring_id",
      "branch_id", "description", "notes", "status",
      "is_recurring_candidate", "is_intercompany",
    ];

    const body = req.body as Record<string, unknown>;
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const camelToSnake = (s: string) => s.replace(/([A-Z])/g, "_$1").toLowerCase();
    for (const [key, val] of Object.entries(body)) {
      const col = camelToSnake(key);
      if (allowed.includes(col)) {
        setClauses.push(`${col} = $${idx++}`);
        params.push(val);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: "no valid fields" });
      return;
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await client.query(
      `UPDATE payable_obligations SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );
    if (!rows[0]) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ obligation: { ...rows[0], effectiveStatus: effectiveStatus(rows[0]) } });
  } catch (err) {
    req.log.error({ err }, "payables: update failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── POST /api/payables/obligations/:id/approve ───────────────────────────────

payablesRouter.post("/payables/obligations/:id/approve", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rows } = await client.query(
      `UPDATE payable_obligations SET status = 'approved', approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('paid', 'cancelled') RETURNING *`,
      [id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "not found or cannot approve" });
      return;
    }
    res.json({ obligation: { ...rows[0], effectiveStatus: effectiveStatus(rows[0]) } });
  } catch (err) {
    req.log.error({ err }, "payables: approve failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── POST /api/payables/obligations/:id/cancel ────────────────────────────────

payablesRouter.post("/payables/obligations/:id/cancel", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rows } = await client.query(
      `UPDATE payable_obligations SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('paid', 'cancelled') RETURNING *`,
      [id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "not found or already finalized" });
      return;
    }
    res.json({ obligation: { ...rows[0], effectiveStatus: effectiveStatus(rows[0]) } });
  } catch (err) {
    req.log.error({ err }, "payables: cancel failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── POST /api/payables/obligations/:id/mark-paid ─────────────────────────────

payablesRouter.post("/payables/obligations/:id/mark-paid", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rows } = await client.query(
      `UPDATE payable_obligations SET status = 'paid', paid_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('paid', 'cancelled') RETURNING *`,
      [id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "not found or already finalized" });
      return;
    }
    res.json({ obligation: { ...rows[0], effectiveStatus: "paid" } });
  } catch (err) {
    req.log.error({ err }, "payables: mark-paid failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/payables/upcoming ───────────────────────────────────────────────

payablesRouter.get("/payables/upcoming", async (req, res) => {
  const client = await pool.connect();
  try {
    const t = today();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { rows } = await client.query(
      `SELECT * FROM payable_obligations
       WHERE status NOT IN ('paid', 'cancelled')
         AND (due_date IS NULL OR due_date <= $1)
       ORDER BY due_date ASC NULLS LAST`,
      [in30],
    );

    const obligations = rows.map((r) => ({ ...r, effectiveStatus: effectiveStatus(r) }));

    const totalExpectedOutflow = obligations.reduce(
      (sum, o) => sum + parseFloat(String(o.amount_total ?? 0)),
      0,
    );
    const overdueTotal = obligations
      .filter((o) => o.effectiveStatus === "overdue")
      .reduce((sum, o) => sum + parseFloat(String(o.amount_total ?? 0)), 0);

    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dueThisWeek = obligations
      .filter((o) => o.due_date && String(o.due_date).slice(0, 10) >= t && String(o.due_date).slice(0, 10) <= weekEnd)
      .reduce((sum, o) => sum + parseFloat(String(o.amount_total ?? 0)), 0);

    res.json({
      totalExpectedOutflow: totalExpectedOutflow.toFixed(2),
      overdueTotal: overdueTotal.toFixed(2),
      dueThisWeek: dueThisWeek.toFixed(2),
      obligations,
      asOf: t,
    });
  } catch (err) {
    req.log.error({ err }, "payables: upcoming failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});

// ─── GET /api/payables/summary ────────────────────────────────────────────────

payablesRouter.get("/payables/summary", async (req, res) => {
  const client = await pool.connect();
  try {
    const t = today();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { rows } = await client.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending_review')                                          AS pending_review_count,
        COUNT(*) FILTER (WHERE status IN ('approved','scheduled'))                                 AS approved_count,
        COUNT(*) FILTER (WHERE status NOT IN ('paid','cancelled') AND due_date < $1)               AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'paid')                                                    AS paid_count,
        COALESCE(SUM(amount_total) FILTER (WHERE status NOT IN ('paid','cancelled') AND due_date <= $2), 0) AS total_due_next_30_days,
        COALESCE(SUM(amount_total) FILTER (WHERE status NOT IN ('paid','cancelled') AND due_date < $1), 0)  AS overdue_total
       FROM payable_obligations`,
      [t, in30],
    );

    const r = rows[0];
    res.json({
      pendingReviewCount: Number(r.pending_review_count),
      approvedCount:      Number(r.approved_count),
      overdueCount:       Number(r.overdue_count),
      paidCount:          Number(r.paid_count),
      totalDueNext30Days: parseFloat(r.total_due_next_30_days).toFixed(2),
      overdueTotal:       parseFloat(r.overdue_total).toFixed(2),
    });
  } catch (err) {
    req.log.error({ err }, "payables: summary failed");
    res.status(500).json({ error: "internal" });
  } finally {
    client.release();
  }
});
