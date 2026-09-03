import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("manual sales lead requires identity, contact and consent", () => {
  const actions = read("../app/api/sales-actions/route.ts");

  assert.match(actions, /action === "createLead"/);
  assert.match(actions, /Укажите имя потенциального клиента/);
  assert.match(actions, /Укажите телефон или email/);
  assert.match(actions, /согласие на обработку контактных данных/);
  assert.match(actions, /entityType: "Потенциальный клиент"/);
  assert.match(actions, /stage: "Заявка"/);
  assert.match(actions, /sourceSystem: "MANUAL_SALES"/);
  assert.doesNotMatch(actions, /LEAD-T-|FAM-T-|SYNTHETIC/);
});

test("integration catalog covers every primary sales acquisition channel without fake runs", () => {
  const catalog = read("../lib/operating-integration-catalog.ts");
  const api = read("../app/api/integrations/route.ts");
  const database = read("../db/index.ts");

  for (const id of [
    "INT-T-ALFACRM", "INT-T-FORMS", "INT-T-PHONE", "INT-T-WHATSAPP", "INT-T-TG",
    "INT-T-VK", "INT-T-YANDEX", "INT-T-MAIL", "INT-T-ADS", "INT-T-SOCIAL",
  ]) assert.match(catalog, new RegExp(id));

  assert.match(catalog, /INSERT OR IGNORE INTO integration_connections/);
  assert.doesNotMatch(catalog, /integration_sync_runs|integration_log_entries|integration_conflicts/);
  assert.doesNotMatch(api, /ensureOperatingIntegrationCatalog/);
  assert.match(database, /ensureOperatingIntegrationCatalogState/);
  assert.match(api, /Банковские ключи вводит только собственник/);
});
