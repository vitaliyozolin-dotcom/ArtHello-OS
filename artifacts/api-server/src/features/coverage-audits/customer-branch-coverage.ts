import { Router } from "express";
import {
  branchId,
  logger,
  pool,
  sql,
  sqlOne,
} from "../../routes/coverage/shared.js";

export const customerBranchCoverageRouter = Router();
import { authenticate, crmProbe } from "../../lib/alphaCrmClient.js";

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/coverage/customer-raw-branch-coverage
// P7.4.2 — Per-branch raw student/customer counts in alpha_raw_records
// ══════════════════════════════════════════════════════════════════════════════

const BRANCH_NAMES: Record<string, string> = {
  "1": "Онлайн школа",
  "2": "Лиственная",
  "3": "Остров",
  "4": "Лыжный",
  "5": "Онлайн Школа",
  "6": "Атлас",
  "7": "Кемпинг",
  "8": "Школа 1-11",
};
const ALL_BRANCH_IDS = ["1", "2", "3", "4", "5", "6", "7", "8"];

customerBranchCoverageRouter.get(
  "/coverage/customer-raw-branch-coverage",
  async (_req, res) => {
    try {
      // Per-branch stats
      const branchRows = await sql<{
        branch_id: string;
        unique_alpha_ids: string;
        record_count: string;
        earliest_synced: string;
        latest_synced: string;
      }>(`
      SELECT
        branch_id,
        COUNT(DISTINCT alpha_id)::text  AS unique_alpha_ids,
        COUNT(*)::text                  AS record_count,
        MIN(synced_at)::text            AS earliest_synced,
        MAX(synced_at)::text            AS latest_synced
      FROM alpha_raw_records
      WHERE entity_type = 'students'
      GROUP BY branch_id
      ORDER BY branch_id
    `);

      const branchMap = new Map(branchRows.map((r) => [r.branch_id, r]));

      const perBranch = ALL_BRANCH_IDS.map((bid) => {
        const row = branchMap.get(bid);
        return {
          branchId: Number(bid),
          branchName: BRANCH_NAMES[bid] ?? `Branch ${bid}`,
          rawStudentCount: row ? Number(row.unique_alpha_ids) : 0,
          rawRecordCount: row ? Number(row.record_count) : 0,
          earliestSynced: row?.earliest_synced ?? null,
          latestSynced: row?.latest_synced ?? null,
          status: row ? "available" : "not_pulled",
        };
      });

      // Multi-branch customer_ids
      const multiRows = await sql<{
        alpha_id: string;
        branch_count: string;
        branches: string[];
      }>(`
      SELECT alpha_id,
             COUNT(DISTINCT branch_id)::text                           AS branch_count,
             array_agg(DISTINCT branch_id ORDER BY branch_id)         AS branches
      FROM alpha_raw_records
      WHERE entity_type = 'students'
      GROUP BY alpha_id
      HAVING COUNT(DISTINCT branch_id) > 1
      ORDER BY COUNT(DISTINCT branch_id) DESC, alpha_id
    `);

      // Global totals
      const totals = await sqlOne<{
        total_records: string;
        unique_ids: string;
        branches_with_data: string;
      }>(`
      SELECT
        COUNT(*)::text                       AS total_records,
        COUNT(DISTINCT alpha_id)::text       AS unique_ids,
        COUNT(DISTINCT branch_id)::text      AS branches_with_data
      FROM alpha_raw_records
      WHERE entity_type = 'students'
    `);

      res.json({
        generatedAt: new Date().toISOString(),
        perBranch,
        global: {
          totalRawRecords: Number(totals?.total_records ?? 0),
          uniqueAlphaIds: Number(totals?.unique_ids ?? 0),
          branchesWithData: Number(totals?.branches_with_data ?? 0),
          branchesWithoutData: 8 - Number(totals?.branches_with_data ?? 0),
          multiBranchCustomers: multiRows.length,
          multiBranchExamples: multiRows.slice(0, 10).map((r) => ({
            alphaId: r.alpha_id,
            branchCount: Number(r.branch_count),
            branches: r.branches,
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, "customer-raw-branch-coverage failed");
      res.status(500).json({ error: "customer-raw-branch-coverage failed" });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/coverage/resolve-ghost-customers
// P7.4.3b — Query AlphaCRM with archived/inactive variants to find the 164
//            ghost customer_ids absent from all currently pulled raw data.
// ══════════════════════════════════════════════════════════════════════════════
customerBranchCoverageRouter.post(
  "/coverage/resolve-ghost-customers",
  async (req, res) => {
    const BRANCH = "6";
    const ENDPOINT = `${BRANCH}/customer/index`;
    const PAGE_SIZE = 50;

    try {
      // ── 1. Load ghost customer_ids from DB ────────────────────────────────────
      const ghostRows = await pool.query<{
        customer_id: string;
        att_count: string;
      }>(
        `SELECT student_alpha_id AS customer_id, COUNT(*)::text AS att_count
       FROM crm_attendance
       WHERE branch_id=$1 AND student_id IS NULL AND student_alpha_id IS NOT NULL
       GROUP BY student_alpha_id ORDER BY COUNT(*) DESC`,
        [BRANCH],
      );
      const ghostSet = new Set(ghostRows.rows.map((r) => r.customer_id));
      const ghostCountByAtt = new Map(
        ghostRows.rows.map((r) => [r.customer_id, Number(r.att_count)]),
      );
      req.log.info(
        { count: ghostSet.size },
        "resolve-ghost-customers: ghost IDs loaded",
      );

      if (ghostSet.size === 0) {
        res.json({
          success: true,
          message: "No ghost customer_ids found — all attendance linked.",
          ghostCount: 0,
          variants: [],
          classification: {},
        });
        return;
      }

      // Authenticate once for all probes
      const token = await authenticate();

      // ── 2. Query variants ────────────────────────────────────────────────────
      type VariantResult = {
        name: string;
        body: Record<string, unknown>;
        httpStatus: number | null;
        totalReported: number | null;
        pagesFetched: number;
        itemsFetched: number;
        ghostIdsFound: string[];
        paginationStatus: string;
        fieldsSample: string[];
        error: string | null;
      };

      const variantDefs: Array<{
        name: string;
        body: Record<string, unknown>;
      }> = [
        { name: "A_DEFAULT", body: {} },
        { name: "B_IS_STUDY_1", body: { is_study: 1 } },
        { name: "C_IS_STUDY_0", body: { is_study: 0 } },
        { name: "D_NO_FILTER", body: {} }, // same as A, confirmed separately
        { name: "E_IS_ARCHIVE_1", body: { is_archive: 1 } },
        { name: "F_IS_ARCHIVE_0", body: { is_archive: 0 } },
        { name: "G_INACTIVE_ARCHIVED", body: { is_study: 0, is_archive: 1 } },
      ];

      // Helper: paginated fetch with loop-detection, max 40 pages
      async function fetchAllPages(
        extraBody: Record<string, unknown>,
      ): Promise<{
        items: Record<string, unknown>[];
        pages: number;
        totalReported: number | null;
        paginationStatus: string;
        httpStatus: number | null;
        error: string | null;
      }> {
        const items: Record<string, unknown>[] = [];
        let page = 0;
        let totalReported: number | null = null;
        let httpStatus: number | null = null;
        let prevIdSet: Set<string> | null = null;

        for (let p = 0; p < 40; p++) {
          const probe = await crmProbe(
            ENDPOINT,
            "POST",
            { page, count: PAGE_SIZE, ...extraBody },
            token,
          );
          httpStatus = probe.status;
          if (probe.error || probe.status === null || probe.status >= 400) {
            return {
              items,
              pages: p,
              totalReported,
              paginationStatus: "error",
              httpStatus,
              error: probe.error ?? `HTTP ${probe.status}`,
            };
          }
          const parsed = probe.parsedJson as Record<string, unknown> | null;
          if (!parsed)
            return {
              items,
              pages: p + 1,
              totalReported,
              paginationStatus: "empty_response",
              httpStatus,
              error: null,
            };

          if (totalReported === null && typeof parsed["total"] === "number")
            totalReported = parsed["total"] as number;
          const pageItems = (
            Array.isArray(parsed["items"]) ? parsed["items"] : []
          ) as Record<string, unknown>[];

          if (pageItems.length === 0)
            return {
              items,
              pages: p + 1,
              totalReported,
              paginationStatus: "ok",
              httpStatus,
              error: null,
            };

          // Loop detection: if id-set is same as prev page → stop
          const idSet = new Set(
            pageItems.map((i) => String(i["id"] ?? i["alpha_id"] ?? "")),
          );
          if (prevIdSet && [...idSet].every((id) => prevIdSet!.has(id))) {
            return {
              items,
              pages: p + 1,
              totalReported,
              paginationStatus: "loop_detected",
              httpStatus,
              error: null,
            };
          }
          prevIdSet = idSet;

          items.push(...pageItems);
          if (pageItems.length < PAGE_SIZE)
            return {
              items,
              pages: p + 1,
              totalReported,
              paginationStatus: "ok",
              httpStatus,
              error: null,
            };
          page++;
        }
        return {
          items,
          pages: 40,
          totalReported,
          paginationStatus: "max_pages_reached",
          httpStatus,
          error: null,
        };
      }

      const variantResults: VariantResult[] = [];

      // Track all found ghost IDs across variants
      const foundByVariant = new Map<string, Set<string>>(); // variantName → set of ghost IDs found

      // Collect payloads directly during scan (keyed by customerId → first-seen payload + hint)
      const variantFoundPayloads = new Map<
        string,
        {
          payload: Record<string, unknown>;
          lifecycleHint: string;
          queryVariant: string;
        }
      >();

      for (const vd of variantDefs) {
        req.log.info(
          { variant: vd.name, body: vd.body },
          "resolve-ghost-customers: probing variant",
        );
        const result = await fetchAllPages(vd.body);
        const ghostFound: string[] = [];
        const fieldsSample: string[] =
          result.items.length > 0
            ? Object.keys(result.items[0]!).slice(0, 15)
            : [];

        for (const item of result.items) {
          const itemId = String(item["id"] ?? "");
          if (!ghostSet.has(itemId)) continue;
          ghostFound.push(itemId);
          // Save payload immediately (first variant wins — preserves priority ordering)
          if (!variantFoundPayloads.has(itemId)) {
            const isArchive = item["is_archive"];
            const isStudy = item["is_study"];
            let lifecycleHint = "unknown";
            if (isArchive === 1 || isArchive === "1")
              lifecycleHint = "archived";
            else if (isStudy === 0 || isStudy === "0")
              lifecycleHint = "inactive";
            else if (isStudy === 1 || isStudy === "1")
              lifecycleHint = "active_unexpected";
            variantFoundPayloads.set(itemId, {
              payload: item,
              lifecycleHint,
              queryVariant: vd.name,
            });
          }
        }

        foundByVariant.set(vd.name, new Set(ghostFound));

        variantResults.push({
          name: vd.name,
          body: vd.body,
          httpStatus: result.httpStatus,
          totalReported: result.totalReported,
          pagesFetched: result.pages,
          itemsFetched: result.items.length,
          ghostIdsFound: ghostFound,
          paginationStatus: result.paginationStatus,
          fieldsSample,
          error: result.error,
        });

        req.log.info(
          {
            variant: vd.name,
            fetched: result.items.length,
            ghostFound: ghostFound.length,
          },
          "resolve-ghost-customers: variant done",
        );
      }

      // ── 3. Direct lookup for top 20 ghost IDs (variant H) ───────────────────
      const top20 = ghostRows.rows.slice(0, 20).map((r) => r.customer_id);
      const directLookupResults: Array<{
        customerId: string;
        found: boolean;
        httpStatus: number | null;
        payload: Record<string, unknown> | null;
        error: string | null;
      }> = [];

      for (const cid of top20) {
        const probe = await crmProbe(
          ENDPOINT,
          "POST",
          { id: Number(cid), page: 0, count: 1 },
          token,
        );
        const parsed = probe.parsedJson as Record<string, unknown> | null;
        const pageItems = (
          parsed && Array.isArray(parsed["items"]) ? parsed["items"] : []
        ) as Record<string, unknown>[];
        const found = pageItems.some((i) => String(i["id"] ?? "") === cid);
        directLookupResults.push({
          customerId: cid,
          found,
          httpStatus: probe.status,
          payload: found ? (pageItems[0] as Record<string, unknown>) : null,
          error: probe.error,
        });
      }

      const directFoundIds = new Set(
        directLookupResults.filter((r) => r.found).map((r) => r.customerId),
      );
      foundByVariant.set("H_DIRECT_LOOKUP", directFoundIds);
      req.log.info(
        { tried: top20.length, found: directFoundIds.size },
        "resolve-ghost-customers: direct lookup done",
      );

      // ── 4. Aggregate all found ghost IDs ─────────────────────────────────────
      // Determine how each ghost ID was found and which variant found it first
      type GhostClassification =
        | "INACTIVE_CUSTOMER_FOUND"
        | "ARCHIVED_CUSTOMER_FOUND"
        | "DIRECT_LOOKUP_FOUND"
        | "STILL_NOT_FOUND";

      // Merge payloads: direct lookup first (higher priority), then variant scan results
      const foundPayloads = new Map<
        string,
        {
          payload: Record<string, unknown>;
          lifecycleHint: string;
          queryVariant: string;
        }
      >();

      // 1. Direct lookup results (highest priority)
      for (const dr of directLookupResults) {
        if (dr.found && dr.payload) {
          foundPayloads.set(dr.customerId, {
            payload: dr.payload,
            lifecycleHint: "direct_lookup",
            queryVariant: "H_DIRECT_LOOKUP",
          });
        }
      }

      // 2. Variant scan results (payloads collected inline during scan — no extra API calls needed)
      for (const [cid, data] of variantFoundPayloads) {
        if (!foundPayloads.has(cid)) {
          foundPayloads.set(cid, data);
        }
      }

      // ── 5. Save found records to alpha_raw_records ───────────────────────────
      let rawSaved = 0;
      const savedIds: string[] = [];

      for (const [
        cid,
        { payload, lifecycleHint, queryVariant },
      ] of foundPayloads) {
        // Augment payload with resolution metadata
        const augmented = {
          ...payload,
          _ghost_resolution: {
            lifecycleHint,
            queryVariant,
            resolvedAt: new Date().toISOString(),
          },
        };
        const hash = Buffer.from(JSON.stringify(augmented))
          .toString("base64")
          .slice(0, 64);

        await pool.query(
          `INSERT INTO alpha_raw_records
           (alpha_id, entity_type, endpoint, branch_id, source_payload, payload_hash, sync_status, is_archived, synced_at)
         VALUES ($1, 'customers_archived', $2, $3, $4, $5, 'ghost_resolved', $6, NOW())
         ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash) DO UPDATE
           SET synced_at = NOW(), sync_status = 'ghost_resolved'`,
          [
            cid,
            ENDPOINT,
            BRANCH,
            JSON.stringify(augmented),
            hash,
            lifecycleHint === "archived",
          ],
        );
        rawSaved++;
        savedIds.push(cid);
      }

      req.log.info({ rawSaved }, "resolve-ghost-customers: raw records saved");

      // ── 6. Classify all 164 ghost IDs ────────────────────────────────────────
      const classificationMap = new Map<string, GhostClassification>();
      const lifecycleHintMap = new Map<string, string>();

      for (const cid of ghostSet) {
        const fp = foundPayloads.get(cid);
        if (!fp) {
          classificationMap.set(cid, "STILL_NOT_FOUND");
          continue;
        }
        const hint = fp.lifecycleHint;
        lifecycleHintMap.set(cid, hint);
        if (hint === "archived")
          classificationMap.set(cid, "ARCHIVED_CUSTOMER_FOUND");
        else if (hint === "inactive")
          classificationMap.set(cid, "INACTIVE_CUSTOMER_FOUND");
        else if (hint === "direct_lookup")
          classificationMap.set(cid, "DIRECT_LOOKUP_FOUND");
        else classificationMap.set(cid, "DIRECT_LOOKUP_FOUND"); // active_unexpected / unknown
      }

      // Summary per classification
      const classSummary: Record<
        GhostClassification,
        { customer_count: number; attendance_count: number; examples: string[] }
      > = {
        ARCHIVED_CUSTOMER_FOUND: {
          customer_count: 0,
          attendance_count: 0,
          examples: [],
        },
        INACTIVE_CUSTOMER_FOUND: {
          customer_count: 0,
          attendance_count: 0,
          examples: [],
        },
        DIRECT_LOOKUP_FOUND: {
          customer_count: 0,
          attendance_count: 0,
          examples: [],
        },
        STILL_NOT_FOUND: {
          customer_count: 0,
          attendance_count: 0,
          examples: [],
        },
      };

      for (const cid of ghostSet) {
        const cls = classificationMap.get(cid) ?? "STILL_NOT_FOUND";
        const bucket = classSummary[cls]!;
        bucket.customer_count++;
        bucket.attendance_count += ghostCountByAtt.get(cid) ?? 0;
        if (bucket.examples.length < 5) bucket.examples.push(cid);
      }

      // ── 7. Update linking issues ──────────────────────────────────────────────
      // Remove old attendance_customer_raw_not_found for Atlas branch
      await pool.query(
        `DELETE FROM alpha_linking_issues WHERE issue_type='attendance_customer_raw_not_found' AND issue_message LIKE $1`,
        [`%branchId=${BRANCH}%`],
      );

      const issueTypeMap: Record<GhostClassification, string> = {
        ARCHIVED_CUSTOMER_FOUND: "attendance_customer_archived_found",
        INACTIVE_CUSTOMER_FOUND: "attendance_customer_inactive_found",
        DIRECT_LOOKUP_FOUND: "attendance_customer_direct_lookup_found",
        STILL_NOT_FOUND: "attendance_customer_raw_not_found",
      };
      const severityMap: Record<GhostClassification, string> = {
        ARCHIVED_CUSTOMER_FOUND: "info",
        INACTIVE_CUSTOMER_FOUND: "warning",
        DIRECT_LOOKUP_FOUND: "info",
        STILL_NOT_FOUND: "warning",
      };
      const actionMap: Record<GhostClassification, string> = {
        ARCHIVED_CUSTOMER_FOUND:
          "Run P7.4.3c to normalize archived customers with lifecycleStatus=archived.",
        INACTIVE_CUSTOMER_FOUND:
          "Run P7.4.3c to normalize inactive customers with lifecycleStatus=inactive.",
        DIRECT_LOOKUP_FOUND:
          "Run P7.4.3c to normalize found customers with appropriate lifecycleStatus.",
        STILL_NOT_FOUND:
          "Customer not found via any query variant or direct lookup. May be hard-deleted from AlphaCRM or require support access.",
      };

      for (const cid of ghostSet) {
        const cls = classificationMap.get(cid) ?? "STILL_NOT_FOUND";
        const attCount = ghostCountByAtt.get(cid) ?? 0;
        const ghRow = ghostRows.rows.find((r) => r.customer_id === cid);
        await pool.query(
          `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type,
            missing_reference_id, severity, suggested_action)
         VALUES ('attendance', $1, $2, $3, 'crm_students', $1, $4, $5)`,
          [
            cid,
            issueTypeMap[cls],
            `branchId=${BRANCH} customer_id=${cid} att_count=${attCount} classification=${cls} lifecycle=${lifecycleHintMap.get(cid) ?? "unknown"}`,
            severityMap[cls],
            actionMap[cls],
          ],
        );
      }

      // ── 8. Top 20 still unresolved ────────────────────────────────────────────
      const top20Unresolved = ghostRows.rows
        .filter(
          (r) => classificationMap.get(r.customer_id) === "STILL_NOT_FOUND",
        )
        .slice(0, 20)
        .map((r) => ({
          customerId: r.customer_id,
          attCount: Number(r.att_count),
          classification: "STILL_NOT_FOUND",
          lifecycleHint: "unknown",
        }));

      req.log.info(
        {
          ghostCount: ghostSet.size,
          rawSaved,
          stillNotFound: classSummary.STILL_NOT_FOUND.customer_count,
        },
        "resolve-ghost-customers: complete",
      );

      res.json({
        success: true,
        branchId: BRANCH,
        generatedAt: new Date().toISOString(),

        ghostCount: ghostSet.size,
        rawRecordsSaved: rawSaved,

        variants: variantResults.map((vr) => ({
          name: vr.name,
          body: vr.body,
          httpStatus: vr.httpStatus,
          totalReported: vr.totalReported,
          pagesFetched: vr.pagesFetched,
          itemsFetched: vr.itemsFetched,
          ghostIdsFound: vr.ghostIdsFound.length,
          ghostExamples: vr.ghostIdsFound.slice(0, 5),
          paginationStatus: vr.paginationStatus,
          fieldsSample: vr.fieldsSample,
          error: vr.error,
        })),

        directLookup: {
          tried: top20.length,
          found: directFoundIds.size,
          notFound: top20.length - directFoundIds.size,
          foundIds: [...directFoundIds],
          results: directLookupResults.map((r) => ({
            customerId: r.customerId,
            found: r.found,
            httpStatus: r.httpStatus,
            error: r.error,
          })),
        },

        classification: classSummary,
        top20Unresolved,

        recommendation:
          classSummary.STILL_NOT_FOUND.customer_count === 0
            ? "All ghost customers resolved. Run P7.4.3c to normalize them with correct lifecycleStatus."
            : classSummary.STILL_NOT_FOUND.customer_count < ghostSet.size
              ? `Partial resolution: ${ghostSet.size - classSummary.STILL_NOT_FOUND.customer_count} found, ${classSummary.STILL_NOT_FOUND.customer_count} still missing. Run P7.4.3c for found ones; accept remaining as hard-deleted or contact AlphaCRM support.`
              : `All ${classSummary.STILL_NOT_FOUND.customer_count} ghost customers remain unresolved. Customers may be hard-deleted from AlphaCRM API or require privileged/admin access.`,
      });
    } catch (err) {
      logger.error({ err }, "resolve-ghost-customers failed");
      res.status(500).json({
        success: false,
        error: "resolve-ghost-customers failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
