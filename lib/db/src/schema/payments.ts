import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { legalEntitiesTable } from "./master-data.js";
import { familiesTable, personsTable } from "./persons.js";
import { authUsersTable } from "./security.js";

export type FiscalProfile = {
  taxSystemCode?: string;
  vatType?: string;
  paymentMethod?: string;
  paymentObject?: string;
  itemName?: string;
  [key: string]: unknown;
};

export const paymentRoutesTable = pgTable(
  "payment_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntitiesTable.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("tochka"),
    providerCustomerCode: text("provider_customer_code").notNull(),
    merchantId: text("merchant_id").notNull(),
    recipientLabel: text("recipient_label").notNull(),
    fiscalProfile: jsonb("fiscal_profile")
      .$type<FiscalProfile>()
      .notNull()
      .default({}),
    fiscalProfileStatus: text("fiscal_profile_status").notNull().default("draft"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(
      () => authUsersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_routes_branch_legal_provider_merchant_uniq").on(
      table.branchCrmId,
      table.legalEntityId,
      table.provider,
      table.merchantId,
    ),
    index("payment_routes_scope_active_idx").on(
      table.branchCrmId,
      table.legalEntityId,
      table.isActive,
    ),
  ],
);

export const paymentObligationsTable = pgTable(
  "payment_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchCrmId: text("branch_crm_id").notNull(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntitiesTable.id, { onDelete: "restrict" }),
    familyId: uuid("family_id").references(() => familiesTable.id, {
      onDelete: "set null",
    }),
    payerPersonId: uuid("payer_person_id").references(() => personsTable.id, {
      onDelete: "set null",
    }),
    studentPersonId: uuid("student_person_id").references(() => personsTable.id, {
      onDelete: "set null",
    }),
    studentCrmId: text("student_crm_id"),
    contractId: text("contract_id"),
    invoiceExternalId: text("invoice_external_id"),
    billingPeriod: date("billing_period"),
    purpose: text("purpose").notNull(),
    amountKopecks: bigint("amount_kopecks", { mode: "number" }).notNull(),
    confirmedPaidKopecks: bigint("confirmed_paid_kopecks", { mode: "number" })
      .notNull()
      .default(0),
    currency: text("currency").notNull().default("RUB"),
    status: text("status").notNull().default("open"),
    evidenceStatus: text("evidence_status").notNull().default("unavailable"),
    dueDate: date("due_date"),
    payerEmail: text("payer_email"),
    payerPhone: text("payer_phone"),
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdByUserId: uuid("created_by_user_id").references(
      () => authUsersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_obligations_scope_status_idx").on(
      table.branchCrmId,
      table.legalEntityId,
      table.status,
    ),
    index("payment_obligations_family_idx").on(table.familyId, table.billingPeriod),
    index("payment_obligations_student_idx").on(
      table.studentCrmId,
      table.billingPeriod,
    ),
  ],
);

export const paymentRequestsTable = pgTable(
  "payment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => paymentObligationsTable.id, { onDelete: "restrict" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => paymentRoutesTable.id, { onDelete: "restrict" }),
    amountKopecks: bigint("amount_kopecks", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    idempotencyKey: text("idempotency_key").notNull(),
    paymentLinkId: text("payment_link_id").notNull(),
    publicTokenHash: text("public_token_hash"),
    providerOperationId: text("provider_operation_id"),
    providerPaymentUrl: text("provider_payment_url"),
    status: text("status").notNull().default("ready"),
    payerContactSnapshot: jsonb("payer_contact_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    fiscalSnapshot: jsonb("fiscal_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(
      () => authUsersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_requests_idempotency_key_uniq").on(table.idempotencyKey),
    uniqueIndex("payment_requests_payment_link_id_uniq").on(table.paymentLinkId),
    uniqueIndex("payment_requests_provider_operation_id_uniq").on(
      table.providerOperationId,
    ),
    index("payment_requests_obligation_status_idx").on(
      table.obligationId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const paymentEventsTable = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => paymentRequestsTable.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("internal"),
    eventIdentity: text("event_identity").notNull(),
    eventType: text("event_type").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    safePayload: jsonb("safe_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    actorUserId: uuid("actor_user_id").references(() => authUsersTable.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_events_provider_identity_uniq").on(
      table.provider,
      table.eventIdentity,
    ),
    index("payment_events_request_created_idx").on(table.requestId, table.createdAt),
  ],
);

export const fiscalReceiptsTable = pgTable(
  "fiscal_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => paymentRequestsTable.id, { onDelete: "restrict" }),
    kind: text("kind").notNull().default("sale"),
    status: text("status").notNull().default("expected"),
    providerReceiptId: text("provider_receipt_id"),
    receiptUrl: text("receipt_url"),
    fiscalProfileSnapshot: jsonb("fiscal_profile_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastErrorCode: text("last_error_code"),
    fiscalizedAt: timestamp("fiscalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fiscal_receipts_request_kind_uniq").on(table.requestId, table.kind),
    index("fiscal_receipts_status_idx").on(table.status, table.createdAt),
  ],
);

export type PaymentRoute = typeof paymentRoutesTable.$inferSelect;
export type PaymentObligation = typeof paymentObligationsTable.$inferSelect;
export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
export type PaymentEvent = typeof paymentEventsTable.$inferSelect;
export type FiscalReceipt = typeof fiscalReceiptsTable.$inferSelect;
