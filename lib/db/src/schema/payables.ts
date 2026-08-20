import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  numeric,
  date,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

// ─── Payable Obligations ──────────────────────────────────────────────────────

export const payableObligationsTable = pgTable("payable_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull().default("draft"),
  counterpartyName: text("counterparty_name").notNull(),
  counterpartyId: uuid("counterparty_id"),
  documentNumber: text("document_number"),
  documentDate: date("document_date"),
  dueDate: date("due_date"),
  servicePeriodFrom: date("service_period_from"),
  servicePeriodTo: date("service_period_to"),
  amountTotal: numeric("amount_total", { precision: 14, scale: 2 }).notNull(),
  amountVat: numeric("amount_vat", { precision: 14, scale: 2 }),
  currency: text("currency").notNull().default("RUB"),
  ddsArticleId: uuid("dds_article_id"),
  opiuArticleId: uuid("opiu_article_id"),
  relatedRecurringId: uuid("related_recurring_id"),
  linkedBankTransactionId: uuid("linked_bank_transaction_id"),
  linkedOperationId: uuid("linked_operation_id"),
  branchId: uuid("branch_id"),
  facilityId: uuid("facility_id"),
  legalEntityId: uuid("legal_entity_id"),
  isRecurringCandidate: boolean("is_recurring_candidate").default(false),
  isIntercompany: boolean("is_intercompany").default(false),
  description: text("description"),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type PayableObligation = typeof payableObligationsTable.$inferSelect;

// ─── Obligation Documents ─────────────────────────────────────────────────────

export const obligationDocumentsTable = pgTable("obligation_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  obligationId: uuid("obligation_id"),
  sourceType: text("source_type").notNull(),
  fileName: text("file_name"),
  fileUrl: text("file_url"),
  mimeType: text("mime_type"),
  documentKind: text("document_kind"),
  extractedText: text("extracted_text"),
  parsedJson: jsonb("parsed_json"),
  parseStatus: text("parse_status").default("not_parsed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type ObligationDocument = typeof obligationDocumentsTable.$inferSelect;

// ─── Incoming Email Documents ─────────────────────────────────────────────────

export const incomingEmailDocumentsTable = pgTable("incoming_email_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  sender: text("sender"),
  subject: text("subject"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  attachmentCount: integer("attachment_count").default(0),
  status: text("status").default("new"),
  linkedObligationId: uuid("linked_obligation_id"),
  rawMetadata: jsonb("raw_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type IncomingEmailDocument =
  typeof incomingEmailDocumentsTable.$inferSelect;
