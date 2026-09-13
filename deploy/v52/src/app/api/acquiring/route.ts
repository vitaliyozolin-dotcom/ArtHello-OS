import { env } from "cloudflare:workers";
import { canAccessApi } from "../../../lib/access-policy";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";

export const dynamic = "force-dynamic";

type PaymentRequestRow = {
  id: string;
  obligation_id: string;
  amount_minor: number;
  currency: string;
  payment_link_id: string;
  status: string;
  recipient_label: string;
  provider_url: string | null;
  receipt_status: string | null;
  created_at: string;
  updated_at: string;
  branch_id: string;
  purpose: string;
  student_name: string | null;
  payer_name: string | null;
};

const ACTIVE_STATUSES = new Set(["ready", "link_creating", "waiting", "authorized"]);
const PAID_STATUSES = new Set(["paid", "captured", "succeeded", "completed"]);
const REFUND_STATUSES = new Set(["refunded", "partially_refunded"]);
const READY_RECEIPT_STATUSES = new Set(["ready", "issued", "sent", "fiscalized"]);

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedRequestContext(request);
    if (!context) return privateJson({ error: "Требуется вход" }, 401);
    if (!canAccessApi(context.auth.user, "/api/acquiring", "GET")) {
      return privateJson({ error: "Нет доступа к эквайрингу" }, 403);
    }

    const requests = await loadPaymentRequests();
    const active = requests.filter((row) => ACTIVE_STATUSES.has(row.status));
    const paid = requests.filter((row) => PAID_STATUSES.has(row.status));
    const refunded = requests.filter((row) => REFUND_STATUSES.has(row.status));
    const receiptsReady = requests.filter((row) => READY_RECEIPT_STATUSES.has(row.receipt_status ?? ""));

    return privateJson({
      requests: requests.map((row) => ({
        id: row.id,
        obligationId: row.obligation_id,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        paymentLinkId: row.payment_link_id,
        status: row.status,
        recipientLabel: row.recipient_label,
        receiptStatus: row.receipt_status || "expected",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        branchId: row.branch_id,
        purpose: row.purpose,
        studentName: row.student_name || "",
        payerName: row.payer_name || "",
        hasProviderLink: Boolean(row.provider_url),
      })),
      summary: {
        paymentRequestCount: requests.length,
        activePaymentRequestCount: active.length,
        paidPaymentCount: paid.length,
        paidMinor: paid.reduce((sum, row) => sum + Number(row.amount_minor), 0),
        refundCount: refunded.length,
        refundedMinor: refunded.reduce((sum, row) => sum + Number(row.amount_minor), 0),
        receiptReadyCount: receiptsReady.length,
        receiptPendingCount: requests.length - receiptsReady.length,
      },
      capabilities: { canOpenPay: context.auth.user.canAccessPay },
      boundary: "Эквайринг показывает только платёжные ссылки, оплаты, возвраты и чеки. Банковские счета, остатки, выписки и синхронизация находятся только в разделе «Деньги».",
    });
  } catch (error) {
    console.error("acquiring.load_failed", error instanceof Error ? error.name : "unknown");
    return privateJson({ error: "Не удалось загрузить эквайринг" }, 503);
  }
}

async function loadPaymentRequests() {
  const [requestTable, obligationTable] = await Promise.all([
    env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='arthello_pay_requests'").first<{ name: string }>(),
    env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='arthello_pay_obligations'").first<{ name: string }>(),
  ]);
  if (!requestTable || !obligationTable) return [] as PaymentRequestRow[];
  const result = await env.DB.prepare(`SELECT
      r.id,r.obligation_id,r.amount_minor,r.currency,r.payment_link_id,r.status,
      r.recipient_label,r.provider_url,r.receipt_status,r.created_at,r.updated_at,
      o.branch_id,o.purpose,o.student_name,o.payer_name
    FROM arthello_pay_requests r
    JOIN arthello_pay_obligations o ON o.id=r.obligation_id
    ORDER BY r.created_at DESC LIMIT 300`).all<PaymentRequestRow>();
  return result.results;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache", expires: "0" } });
}
