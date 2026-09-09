import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bankTransactionsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";

export const categorizationRouter = Router();

// ─── Seed rules (P3.1 + P3.2) ────────────────────────────────────────────────
// matchDirection: 'any' | 'income' | 'expense'  — P3.2 addition

const SEED_RULES = [
  {
    ruleName: "Internal transfer ArtHello",
    matchField: "counterparty",
    matchType: "contains",
    pattern: "АРТХЕЛЛО",
    matchDirection: "any",
    suggestedAction: "internal_transfer",
    suggestedArticleId: null as string | null,
    confidence: 98,
    priority: 10,
  },
  // P3.2: expense "Комиссия" at pri=15 wins over the generic bank-commission rule at pri=20
  {
    ruleName: "QR commission expense",
    matchField: "purpose",
    matchType: "contains",
    pattern: "Комиссия",
    matchDirection: "expense",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_BANK_COMMISSION",
    confidence: 96,
    priority: 15,
  },
  {
    ruleName: "Bank commission",
    matchField: "purpose",
    matchType: "contains",
    pattern: "Комиссия",
    matchDirection: "any",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_BANK_COMMISSION",
    confidence: 95,
    priority: 20,
  },
  {
    ruleName: "Acquiring commission",
    matchField: "purpose",
    matchType: "contains",
    pattern: "эквайринг",
    matchDirection: "any",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_ACQUIRING",
    confidence: 92,
    priority: 21,
  },
  {
    ruleName: "Payroll tax NDFL",
    matchField: "purpose",
    matchType: "contains",
    pattern: "НДФЛ",
    matchDirection: "any",
    suggestedAction: "ignore",
    suggestedArticleId: null as string | null,
    confidence: 92,
    priority: 25,
  },
  {
    ruleName: "Self-employed contractor payment",
    matchField: "purpose",
    matchType: "contains",
    pattern: "самозанят",
    matchDirection: "any",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_CONTRACTORS",
    confidence: 90,
    priority: 30,
  },
  {
    ruleName: "OZON supplies",
    matchField: "counterparty",
    matchType: "contains",
    pattern: "OZON",
    matchDirection: "any",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_HOZTOVAR",
    confidence: 88,
    priority: 40,
  },
  {
    ruleName: "Wildberries supplies",
    matchField: "counterparty",
    matchType: "contains",
    pattern: "WILDBERRIES",
    matchDirection: "any",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_HOZTOVAR",
    confidence: 85,
    priority: 41,
  },
  // P3.2: QR and СБП restricted to income — expense "Комиссия QR/СБП" caught by rule at pri=15
  {
    ruleName: "QR income (family payment)",
    matchField: "purpose",
    matchType: "contains",
    pattern: "QR",
    matchDirection: "income",
    suggestedAction: "family",
    suggestedArticleId: null as string | null,
    confidence: 82,
    priority: 50,
  },
  {
    ruleName: "Sbp income (family payment)",
    matchField: "purpose",
    matchType: "contains",
    pattern: "СБП",
    matchDirection: "income",
    suggestedAction: "family",
    suggestedArticleId: null as string | null,
    confidence: 78,
    priority: 55,
  },
  {
    ruleName: "Rent payment",
    matchField: "purpose",
    matchType: "contains",
    pattern: "аренд",
    matchDirection: "any",
    suggestedAction: "contractor",
    suggestedArticleId: "ARTICLE_RENT",
    confidence: 88,
    priority: 60,
  },
] as const;

// Article code → DB code lookup
const ARTICLE_CODE_MAP: Record<string, string> = {
  ARTICLE_BANK_COMMISSION: "7.1",
  ARTICLE_CONTRACTORS: "9.4",
  ARTICLE_HOZTOVAR: "9.2",
  ARTICLE_RENT: "3.1",
  ARTICLE_ACQUIRING: "7.2",
};

// ─── POST /banking/setup-suggestion-rules ─────────────────────────────────────
// Idempotent: adds missing columns (P3.1 + P3.2) and seeds/updates rules.

categorizationRouter.post(
  "/banking/setup-suggestion-rules",
  async (req, res) => {
    try {
      // Step 1: add P3.1 columns (idempotent)
      await db.execute(sql`
      ALTER TABLE categorization_rules
        ADD COLUMN IF NOT EXISTS match_field          TEXT,
        ADD COLUMN IF NOT EXISTS match_type           TEXT,
        ADD COLUMN IF NOT EXISTS pattern              TEXT,
        ADD COLUMN IF NOT EXISTS suggested_article_id UUID,
        ADD COLUMN IF NOT EXISTS suggested_action     TEXT,
        ADD COLUMN IF NOT EXISTS confidence           INTEGER DEFAULT 80
    `);

      // Step 2: add P3.2 column (idempotent)
      await db.execute(sql`
      ALTER TABLE categorization_rules
        ADD COLUMN IF NOT EXISTS match_direction TEXT NOT NULL DEFAULT 'any'
    `);

      // Step 3: resolve article ids from DB
      const articleRows = await db.execute(sql`
      SELECT id::text, code FROM articles WHERE is_active = true
    `);
      const codeToId: Record<string, string> = {};
      for (const row of articleRows.rows as Array<{
        id: string;
        code: string;
      }>) {
        codeToId[row.code] = row.id;
      }

      let seeded = 0;
      let updated = 0;
      let skipped = 0;

      for (const rule of SEED_RULES) {
        let articleId: string | null = null;
        if (
          rule.suggestedArticleId &&
          ARTICLE_CODE_MAP[rule.suggestedArticleId]
        ) {
          articleId =
            codeToId[ARTICLE_CODE_MAP[rule.suggestedArticleId]] ?? null;
        }

        // Check if rule exists with match_field already set
        const exists = await db.execute(sql`
        SELECT id FROM categorization_rules
        WHERE rule_name = ${rule.ruleName} AND match_field IS NOT NULL
        LIMIT 1
      `);

        if ((exists.rows?.length ?? 0) > 0) {
          // Rule exists — update match_direction (P3.2 migration for existing rules)
          await db.execute(sql`
          UPDATE categorization_rules
          SET match_direction = ${rule.matchDirection},
              confidence      = ${rule.confidence},
              priority        = ${rule.priority}
          WHERE rule_name = ${rule.ruleName} AND match_field IS NOT NULL
        `);
          updated++;
        } else {
          // Insert new rule
          await db.execute(sql`
          INSERT INTO categorization_rules
            (id, rule_name, match_field, match_type, pattern, match_direction,
             suggested_article_id, suggested_action, confidence, priority, is_active)
          VALUES
            (gen_random_uuid(), ${rule.ruleName}, ${rule.matchField}, ${rule.matchType},
             ${rule.pattern}, ${rule.matchDirection},
             ${articleId}, ${rule.suggestedAction},
             ${rule.confidence}, ${rule.priority}, true)
        `);
          seeded++;
        }
      }

      req.log.info(
        { seeded, updated, skipped },
        "setup-suggestion-rules P3.2 complete",
      );
      res.json({
        ok: true,
        seeded,
        updated,
        skipped,
        totalRules: SEED_RULES.length,
      });
    } catch (err) {
      req.log.error({ err }, "POST /banking/setup-suggestion-rules failed");
      res.status(500).json({ error: String(err) });
    }
  },
);

// ─── GET /banking/categorization-rules ───────────────────────────────────────
// Returns all active suggestion-engine rules (client applies client-side).

categorizationRouter.get("/banking/categorization-rules", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        r.id::text                        AS id,
        r.rule_name                       AS "ruleName",
        r.match_field                     AS "matchField",
        r.match_type                      AS "matchType",
        r.pattern,
        COALESCE(r.match_direction, 'any') AS "matchDirection",
        r.suggested_action                AS "suggestedAction",
        r.suggested_article_id::text      AS "suggestedArticleId",
        a.name                            AS "suggestedArticleName",
        a.code                            AS "suggestedArticleCode",
        COALESCE(r.confidence, 80)        AS confidence,
        COALESCE(r.priority, 100)         AS priority
      FROM categorization_rules r
      LEFT JOIN articles a ON a.id = r.suggested_article_id
      WHERE r.is_active = true
        AND r.match_field IS NOT NULL
        AND r.pattern IS NOT NULL
      ORDER BY r.priority ASC, r.confidence DESC
    `);
    res.json({ rules: rows.rows });
  } catch (err) {
    logger.error({ err }, "GET /banking/categorization-rules failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /banking/transactions/:id/suggestion ─────────────────────────────────
// Direction-aware suggestion engine. READ-ONLY.

categorizationRouter.get(
  "/banking/transactions/:id/suggestion",
  async (req, res) => {
    try {
      const { id } = req.params;

      const txRows = await db
        .select({
          id: bankTransactionsTable.id,
          counterpartyName: bankTransactionsTable.counterpartyName,
          purpose: bankTransactionsTable.purpose,
          bankName: bankTransactionsTable.bankName,
          direction: bankTransactionsTable.direction,
          matchStatus: bankTransactionsTable.matchStatus,
        })
        .from(bankTransactionsTable)
        .where(eq(bankTransactionsTable.id, id))
        .limit(1);

      if (!txRows[0]) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      const tx = txRows[0];

      const rulesResult = await db.execute(sql`
      SELECT
        r.id::text                        AS id,
        r.rule_name                       AS rule_name,
        r.match_field,
        r.match_type,
        r.pattern,
        COALESCE(r.match_direction, 'any') AS match_direction,
        r.suggested_action,
        r.suggested_article_id::text      AS suggested_article_id,
        a.name                            AS article_name,
        a.code                            AS article_code,
        COALESCE(r.confidence, 80)        AS confidence,
        COALESCE(r.priority, 100)         AS priority
      FROM categorization_rules r
      LEFT JOIN articles a ON a.id = r.suggested_article_id
      WHERE r.is_active = true
        AND r.match_field IS NOT NULL
        AND r.pattern IS NOT NULL
      ORDER BY r.priority ASC, r.confidence DESC
    `);

      type RuleRow = {
        id: string;
        rule_name: string | null;
        match_field: string;
        match_type: string;
        pattern: string;
        match_direction: string;
        suggested_action: string | null;
        suggested_article_id: string | null;
        article_name: string | null;
        article_code: string | null;
        confidence: number;
        priority: number;
      };

      const rules = rulesResult.rows as RuleRow[];

      for (const rule of rules) {
        // P3.2: direction guard — skip rule if direction doesn't match
        const txDir = tx.direction ?? "unknown";
        if (rule.match_direction !== "any" && rule.match_direction !== txDir)
          continue;

        const fieldValue = (() => {
          switch (rule.match_field) {
            case "counterparty":
              return tx.counterpartyName ?? "";
            case "purpose":
              return tx.purpose ?? "";
            case "bank_name":
              return tx.bankName ?? "";
            case "direction":
              return tx.direction ?? "";
            default:
              return "";
          }
        })();

        const pattern = rule.pattern;
        let matches = false;
        switch (rule.match_type) {
          case "contains":
            matches = fieldValue.toLowerCase().includes(pattern.toLowerCase());
            break;
          case "equals":
            matches = fieldValue.toLowerCase() === pattern.toLowerCase();
            break;
          case "starts_with":
            matches = fieldValue
              .toLowerCase()
              .startsWith(pattern.toLowerCase());
            break;
          case "regex":
            try {
              matches = new RegExp(pattern, "i").test(fieldValue);
            } catch {
              matches = false;
            }
            break;
        }

        if (matches) {
          res.json({
            suggestion: {
              suggestedAction: rule.suggested_action,
              suggestedArticleId: rule.suggested_article_id,
              suggestedArticleName: rule.article_name,
              suggestedArticleCode: rule.article_code,
              confidence: Number(rule.confidence),
              matchedRuleId: rule.id,
              matchedRuleName: rule.rule_name,
              matchDirection: rule.match_direction,
            },
          });
          return;
        }
      }

      res.json({ suggestion: null });
    } catch (err) {
      req.log.error({ err }, "GET /banking/transactions/:id/suggestion failed");
      res.status(500).json({ error: String(err) });
    }
  },
);

// ─── GET /banking/suggestion-stats ────────────────────────────────────────────
// Coverage stats with direction-aware engine. READ-ONLY.

categorizationRouter.get("/banking/suggestion-stats", async (_req, res) => {
  try {
    const rulesResult = await db.execute(sql`
      SELECT
        r.id::text, r.rule_name, r.match_field, r.match_type, r.pattern,
        COALESCE(r.match_direction, 'any') AS match_direction,
        r.suggested_action, r.suggested_article_id::text,
        COALESCE(r.confidence, 80) AS confidence,
        COALESCE(r.priority, 100)  AS priority
      FROM categorization_rules r
      WHERE r.is_active = true AND r.match_field IS NOT NULL AND r.pattern IS NOT NULL
      ORDER BY r.priority ASC, r.confidence DESC
    `);

    type RuleRow = {
      id: string;
      rule_name: string | null;
      match_field: string;
      match_type: string;
      pattern: string;
      match_direction: string;
      suggested_action: string | null;
      suggested_article_id: string | null;
      confidence: number;
      priority: number;
    };
    const rules = rulesResult.rows as RuleRow[];

    const txResult = await db.execute(sql`
      SELECT id::text, counterparty_name, purpose, bank_name, direction
      FROM bank_transactions
      WHERE match_status = 'unmatched'
      LIMIT 2000
    `);

    type TxRow = {
      id: string;
      counterparty_name: string | null;
      purpose: string | null;
      bank_name: string | null;
      direction: string | null;
    };
    const txns = txResult.rows as TxRow[];

    const ruleHits: Record<string, number> = {};
    let withSuggestion = 0;
    let withoutSuggestion = 0;

    for (const tx of txns) {
      let matched = false;
      const txDir = tx.direction ?? "unknown";

      for (const rule of rules) {
        // P3.2: direction guard
        if (rule.match_direction !== "any" && rule.match_direction !== txDir)
          continue;

        const fieldValue = (() => {
          switch (rule.match_field) {
            case "counterparty":
              return tx.counterparty_name ?? "";
            case "purpose":
              return tx.purpose ?? "";
            case "bank_name":
              return tx.bank_name ?? "";
            case "direction":
              return tx.direction ?? "";
            default:
              return "";
          }
        })();
        const pattern = rule.pattern;
        let hits = false;
        switch (rule.match_type) {
          case "contains":
            hits = fieldValue.toLowerCase().includes(pattern.toLowerCase());
            break;
          case "equals":
            hits = fieldValue.toLowerCase() === pattern.toLowerCase();
            break;
          case "starts_with":
            hits = fieldValue.toLowerCase().startsWith(pattern.toLowerCase());
            break;
          case "regex":
            try {
              hits = new RegExp(pattern, "i").test(fieldValue);
            } catch {
              hits = false;
            }
            break;
        }
        if (hits) {
          ruleHits[rule.id] = (ruleHits[rule.id] ?? 0) + 1;
          matched = true;
          break;
        }
      }
      if (matched) withSuggestion++;
      else withoutSuggestion++;
    }

    const topRules = rules
      .filter((r) => ruleHits[r.id])
      .map((r) => ({
        ruleId: r.id,
        ruleName: r.rule_name,
        hits: ruleHits[r.id] ?? 0,
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10);

    res.json({
      totalScanned: txns.length,
      withSuggestion,
      withoutSuggestion,
      coveragePct:
        txns.length > 0 ? Math.round((withSuggestion / txns.length) * 100) : 0,
      topRules,
      totalRules: rules.length,
    });
  } catch (err) {
    logger.error({ err }, "GET /banking/suggestion-stats failed");
    res.status(500).json({ error: String(err) });
  }
});
