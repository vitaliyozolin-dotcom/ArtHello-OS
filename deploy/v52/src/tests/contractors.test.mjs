import test from "node:test";
import assert from "node:assert/strict";
import { buildContractorRegister } from "../lib/contractors.ts";

test("contractors are derived only from supplied payment rows", () => {
  const register = buildContractorRegister([
    { counterpartyEntityId: "CTR-1", amountMinor: 12000, operationDate: "2026-01-02", category: "Аренда", contractId: "DOG-1", documentId: "ACT-1", sourceSystem: "XLSX_ODDS" },
    { counterpartyEntityId: "CTR-1", amountMinor: 8000, operationDate: "2026-02-02", category: "Аренда", contractId: "DOG-1", documentId: "ACT-2", sourceSystem: "XLSX_ODDS" },
    { counterpartyEntityId: "CTR-2", amountMinor: 5000, operationDate: "2026-01-10", category: "Связь", contractId: "", documentId: "INV-2", sourceSystem: "BANK" },
  ]);
  assert.deepEqual(register.map((row) => row.id), ["CTR-1", "CTR-2"]);
  assert.equal(register[0].paymentCount, 2);
  assert.equal(register[0].totalMinor, 20000);
  assert.deepEqual(register[0].contracts, ["DOG-1"]);
});

test("invalid and zero payment rows never create a contractor", () => {
  assert.deepEqual(buildContractorRegister([
    { counterpartyEntityId: "", amountMinor: 100, operationDate: "2026-01-01", category: "—", contractId: "", documentId: "", sourceSystem: "MANUAL" },
    { counterpartyEntityId: "CTR-0", amountMinor: 0, operationDate: "2026-01-01", category: "—", contractId: "", documentId: "", sourceSystem: "MANUAL" },
  ]), []);
});
