import {
  pgTable, uuid, text, numeric, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

export const documentsTable = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  docType: text("doc_type").notNull().default("other"),
  // invoice | contract | act | upd | reconciliation | payroll | tax | other
  docNumber: text("doc_number"),
  docDate: date("doc_date"),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  fileName: text("file_name"),
  fileUrl: text("file_url"),
  status: text("status").default("received"),
  // expected | received | signed | archived
  linkedOperationId: uuid("linked_operation_id"),
  linkedContractorId: uuid("linked_contractor_id"),
  linkedPeriod: text("linked_period"),          // YYYY-MM
  counterpartyName: text("counterparty_name"),
  description: text("description"),
  aiStatus: text("ai_status").default("pending"),
  // pending | ok | issues_found
  aiNotes: text("ai_notes"),
  isTestData: boolean("is_test_data").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Document = typeof documentsTable.$inferSelect;
export type InsertDocument = typeof documentsTable.$inferInsert;
