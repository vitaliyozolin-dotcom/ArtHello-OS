import {
  pgTable, uuid, text, numeric, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

// ─── Universal Contracts ──────────────────────────────────────────────────────
// Covers: family | employee | contractor | external_teacher | rental | supply | service

export const contractsTable = pgTable("contracts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  contractType:   text("contract_type").notNull().default("family"),
  contractNumber: text("contract_number"),
  title:          text("title"),
  status:         text("status").default("active"),
  // draft | active | suspended | terminated | expired
  startDate:      date("start_date"),
  endDate:        date("end_date"),
  signedAt:       date("signed_at"),
  autoRenewal:    boolean("auto_renewal").default(false),
  // monetary
  monthlyAmount:  numeric("monthly_amount", { precision: 15, scale: 2 }),
  totalAmount:    numeric("total_amount",   { precision: 15, scale: 2 }),
  currency:       text("currency").default("RUB"),
  paymentTerms:   text("payment_terms"),
  // soft links
  familyId:       uuid("family_id"),
  personId:       uuid("person_id"),
  counterpartyId: uuid("counterparty_id"),
  studentCrmId:   text("student_crm_id"),
  directionId:    uuid("direction_id"),
  branchCrmId:    text("branch_crm_id"),
  // document
  fileUrl:        text("file_url"),
  notes:          text("notes"),
  isTestData:     boolean("is_test_data").default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Contract = typeof contractsTable.$inferSelect;
export type NewContract = typeof contractsTable.$inferInsert;
