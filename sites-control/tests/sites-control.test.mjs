import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectRoot = resolve(import.meta.dirname, "../..");
const migrationRoot = resolve(projectRoot, "dist/.openai/drizzle");
const migrationFiles = (await readdir(migrationRoot))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const [workerSource, migrationParts] = await Promise.all([
  readFile(resolve(projectRoot, "dist/server/index.js"), "utf8"),
  Promise.all(
    migrationFiles.map((name) =>
      readFile(resolve(migrationRoot, name), "utf8"),
    ),
  ),
]);
const migrationSource = migrationParts.join("\n");
const workerUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`;
const { default: worker } = await import(workerUrl);

function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migrationSource.replaceAll("--> statement-breakpoint", ""));

  const prepare = (sql) => {
    const state = { bindings: [] };
    return {
      bind(...bindings) {
        state.bindings = bindings;
        return this;
      },
      async all() {
        return {
          results: sqlite.prepare(sql).all(...state.bindings),
          success: true,
        };
      },
      async first() {
        return sqlite.prepare(sql).get(...state.bindings) ?? null;
      },
      async run() {
        const result = sqlite.prepare(sql).run(...state.bindings);
        return {
          success: true,
          meta: { changes: Number(result.changes ?? 0) },
        };
      },
      _execute() {
        if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
          return {
            results: sqlite.prepare(sql).all(...state.bindings),
            success: true,
          };
        }
        const result = sqlite.prepare(sql).run(...state.bindings);
        return {
          results: [],
          success: true,
          meta: { changes: Number(result.changes ?? 0) },
        };
      },
    };
  };

  return {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement._execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      sqlite.close();
    },
  };
}

function testEnv(DB, values = {}) {
  return {
    DB,
    ARTHELLO_OWNER_EMAIL: "owner@example.com",
    ARTHELLO_IMPORT_TOKEN: "i".repeat(64),
    ARTHELLO_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
    ARTHELLO_LEAD_RETENTION_DAYS: "30",
    ...values,
  };
}

function ownerRequest(path, init = {}) {
  return new Request(`https://control.example${path}`, {
    ...init,
    headers: {
      "oai-authenticated-user-email": "owner@example.com",
      ...(init.headers ?? {}),
    },
  });
}

const readModelDatasetNames = [
  "employees",
  "employee_payroll_monthly",
  "employee_payroll_components",
  "employee_payroll_payments",
  "payroll_unresolved",
  "alpha_branches",
  "alpha_students",
  "family_candidates",
  "alpha_groups",
  "alpha_teachers",
  "alpha_teacher_rates",
  "alpha_lessons",
  "alpha_payments",
  "sync_status",
];

function testSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function testCompareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function testDatasetDigest(dataset, rows) {
  const key = dataset === "sync_status" ? "source" : "id";
  const pairs = rows
    .map((row) => [
      String(row[key]),
      testSha256(
        JSON.stringify(
          Object.fromEntries(
            Object.keys(row)
              .sort(testCompareText)
              .map((field) => [field, row[field] ?? null]),
          ),
        ),
      ),
    ])
    .sort((left, right) => testCompareText(left[0], right[0]));
  return testSha256(JSON.stringify(pairs));
}

function testSnapshotManifest(datasets) {
  const expectedDigests = Object.fromEntries(
    readModelDatasetNames.map((dataset) => [
      dataset,
      testDatasetDigest(dataset, datasets[dataset]),
    ]),
  );
  return {
    expectedCounts: Object.fromEntries(
      readModelDatasetNames.map((dataset) => [
        dataset,
        datasets[dataset].length,
      ]),
    ),
    expectedDigests,
    payloadDigest: testSha256(
      JSON.stringify(
        readModelDatasetNames.map((dataset) => [
          dataset,
          expectedDigests[dataset],
        ]),
      ),
    ),
  };
}

async function publishReadModelSnapshot(
  worker,
  env,
  providedDatasets,
  options = {},
) {
  const batchId = crypto.randomUUID();
  const datasets = Object.fromEntries(
    readModelDatasetNames.map((dataset) => [
      dataset,
      providedDatasets[dataset] ?? [],
    ]),
  );
  const manifest = testSnapshotManifest(datasets);
  const headers = {
    "content-type": "application/json",
    "x-arthello-import-token": env.ARTHELLO_IMPORT_TOKEN,
  };
  const begin = await worker.fetch(
    new Request("https://control.example/api/admin/read-model/snapshot/begin", {
      method: "POST",
      headers,
      body: JSON.stringify({
        batchId,
        payloadDigest: options.payloadDigest ?? manifest.payloadDigest,
        expectedCounts: manifest.expectedCounts,
        expectedDigests: options.expectedDigests ?? manifest.expectedDigests,
      }),
    }),
    env,
  );
  assert.equal(begin.status, 200);
  const stagedDatasets = options.stagedDatasets ?? datasets;
  for (const [dataset, rows] of Object.entries(stagedDatasets)) {
    const staged = await worker.fetch(
      new Request(
        `https://control.example/api/admin/read-model/snapshot/${batchId}/${dataset}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ replace: true, rows }),
        },
      ),
      env,
    );
    assert.equal(staged.status, 200);
  }
  const commit = await worker.fetch(
    new Request(
      `https://control.example/api/admin/read-model/snapshot/${batchId}/commit`,
      {
        method: "POST",
        headers,
        body: "{}",
      },
    ),
    env,
  );
  return { batchId, commit, datasets, manifest };
}

test("serves the owner control surface with noindex and no embedded PII", async () => {
  const response = await worker.fetch(new Request("https://control.example/"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(html, /owner-only/i);
  assert.match(html, /Операционный пульс ArtHello/);
  assert.match(html, /Реальные данные/);
  assert.match(html, /Payroll sandbox: PASS/);
  assert.match(html, /Production \/ legacy Replit: BLOCKED/);
  assert.doesNotMatch(html, /CONSENT PENDING|32 data-import tests/);
  assert.doesNotMatch(html, /owner123|accountant123|viewer123/i);
  assert.doesNotMatch(html, /arthellonew\.s20\.online/i);
  assert.equal(response.headers.get("x-frame-options"), null);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'self' https:\/\/chatgpt\.com https:\/\/\*\.chatgpt\.com/,
  );
});

test("Front Office accepts real inbound leads but has no outbound action", async () => {
  const [html, javascript] = await Promise.all([
    readFile(resolve(projectRoot, "sites-control/index.html"), "utf8"),
    readFile(resolve(projectRoot, "sites-control/main.js"), "utf8"),
  ]);

  assert.match(html, /data-section="front-office"/);
  assert.match(html, /ARTHELLO/);
  assert.match(html, /MANUAL_REPLY/);
  assert.match(html, /id="fo-data-mode"/);
  assert.match(html, /Клиенту[\s\S]*?ничего не отправляется/);
  assert.match(html, /data-fo-send[\s\S]*?disabled/);
  assert.match(html, /data-fo-metric="all"/);
  assert.match(html, /id="fo-open-profile"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /data-fo-profile-tab="overview"/);
  assert.match(html, /id="fo-profile-contact-fields"/);
  assert.match(html, /Профиль семьи ещё не связан/);
  assert.match(
    html,
    /front-office-profile-header-actions[\s\S]*?disabled[\s\S]*?Написать клиенту/,
  );
  assert.match(html, /Новые заявки подключённых каналов появляются здесь/);
  assert.match(javascript, /function openFrontOfficeProfile/);
  assert.match(javascript, /data-fo-lead-id/);
  assert.match(javascript, /\/api\/front-office\/leads/);
  assert.match(javascript, /front-office-contact-link/);
  assert.doesNotMatch(javascript, /\/api\/front-office\/.*\/send/);
  assert.doesNotMatch(javascript, /localStorage|sessionStorage/);
});

test("owner loaders fail safely and disclose read-model attestation state", async () => {
  const javascript = await readFile(
    resolve(projectRoot, "sites-control/main.js"),
    "utf8",
  );
  assert.match(javascript, /Array\.isArray\(data\?\.rows\)/);
  assert.match(javascript, /Array\.isArray\(data\?\.components\)/);
  assert.match(javascript, /Array\.isArray\(data\?\.payments\)/);
  assert.match(javascript, /Read-модель: legacy \/ unattested/);
  assert.match(javascript, /Atomic · проверено серверным SHA-256/);
  assert.match(javascript, /В текущем источнике пока нет доступных строк/);
  assert.doesNotMatch(
    javascript,
    /Данные не загружены:\s*\$\{error\.message\}/,
  );
  assert.doesNotMatch(
    javascript,
    /Подключение не началось:\s*\$\{error\.message\}/,
  );
});

test("Integration Center is simplified, ARTHELLO-only, and manual-reply", async () => {
  const [html, javascript, stylesheet, contract] = await Promise.all([
    readFile(resolve(projectRoot, "sites-control/index.html"), "utf8"),
    readFile(resolve(projectRoot, "sites-control/main.js"), "utf8"),
    readFile(resolve(projectRoot, "sites-control/styles.css"), "utf8"),
    readFile(
      resolve(projectRoot, "docs/front-office-integration-center.md"),
      "utf8",
    ),
  ]);

  assert.match(html, /data-section="integrations"/);
  assert.match(html, /<h1 id="integrations-title">Подключения<\/h1>/);
  assert.match(html, /MANUAL_REPLY/);
  assert.match(html, /OUTBOUND_OFF/);
  assert.match(html, /Пилот на реальных входящих/);
  assert.match(html, /id="integration-catalog"/);
  assert.match(html, /id="integration-drawer-layer"/);
  assert.match(html, /integration-drawer-back/);
  assert.match(html, /← Назад/);
  assert.doesNotMatch(html, /integration-drawer-close/);
  assert.equal((html.match(/data-integration-close/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Закрыть план подключения/);
  assert.match(html, /id="integration-simple-setup"/);
  assert.match(javascript, /history\.pushState/);
  assert.match(javascript, /popstate/);
  assert.match(javascript, /document\.body\.append\(integrationDrawerPortal\)/);
  assert.equal((javascript.match(/guide:\s*{/g) ?? []).length, 9);
  assert.match(javascript, /Что подготовить/);
  assert.match(javascript, /Как подключить/);
  assert.match(javascript, /Как понять, что всё работает/);
  assert.match(
    stylesheet,
    /\.integration-drawer-body\s*{[\s\S]*?min-height:\s*0;/,
  );
  assert.match(
    stylesheet,
    /\.integration-drawer > header\s*{[\s\S]*?flex:\s*0 0 auto;/,
  );
  assert.match(javascript, /\/api\/integrations\/site-webflow\/start/);
  assert.match(javascript, /name: "Сайт и веб-чат"/);
  assert.match(javascript, /name: "Telegram"/);
  assert.match(javascript, /name: "VK · сообщения"/);
  assert.match(javascript, /name: "WhatsApp Business"/);
  assert.match(javascript, /name: "MAX"/);
  assert.match(javascript, /name: "Instagram · сообщения"/);
  assert.match(javascript, /name: "Яндекс Метрика"/);
  assert.match(javascript, /name: "Яндекс Директ"/);
  assert.match(javascript, /name: "VK Ads"/);
  assert.doesNotMatch(
    javascript,
    /api\.telegram\.org|graph\.facebook\.com|api\.vk\.com|api\.direct\.yandex/,
  );
  assert.doesNotMatch(javascript, /localStorage|sessionStorage/);
  assert.match(contract, /PROJECT_ID = ARTHELLO/);
  assert.match(contract, /Яндекс Директ: поиск и РСЯ в одном коннекторе/);
  assert.match(contract, /BlackVillage не присутствует/);
});

test("Webflow pilot creates idempotent real leads and keeps contacts sealed at rest", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  try {
    const missingRetention = await worker.fetch(
      ownerRequest("/api/integrations/site-webflow/start", {
        method: "POST",
        headers: { "x-arthello-action": "owner-confirmed" },
      }),
      testEnv(DB, { ARTHELLO_LEAD_RETENTION_DAYS: "" }),
    );
    assert.equal(missingRetention.status, 409);
    assert.equal(
      (await missingRetention.json()).error,
      "RETENTION_POLICY_REQUIRED",
    );

    const missingAction = await worker.fetch(
      ownerRequest("/api/integrations/site-webflow/start", {
        method: "POST",
      }),
      env,
    );
    assert.equal(missingAction.status, 403);

    const started = await worker.fetch(
      ownerRequest("/api/integrations/site-webflow/start", {
        method: "POST",
        headers: { "x-arthello-action": "owner-confirmed" },
      }),
      env,
    );
    assert.equal(started.status, 200);
    const setup = await started.json();
    assert.equal(setup.outboundEnabled, false);
    const webhookUrl = new URL(setup.webhookUrl);
    assert.match(
      webhookUrl.pathname,
      /^\/api\/webhooks\/arthello\/webflow\/[a-f0-9]{64}$/,
    );

    const token = webhookUrl.pathname.split("/").at(-1);
    const wrongToken = `${token[0] === "a" ? "b" : "a"}${token.slice(1)}`;
    const rejected = await worker.fetch(
      new Request(
        `https://control.example/api/webhooks/arthello/webflow/${wrongToken}`,
        { method: "POST", body: "{}" },
      ),
      env,
    );
    assert.equal(rejected.status, 403);

    const payload = {
      triggerType: "form_submission",
      payload: {
        id: "submission-1",
        siteId: "arthello-webflow-site",
        formId: "lead-form",
        name: "Записаться на экскурсию",
        submittedAt: "2026-07-26T12:00:00.000Z",
        data: {
          Имя: "Тестовый родитель",
          "Номер телефона": "+7 900 111-22-33",
          Сообщение: "Хотим подобрать программу рядом с домом.",
          utm_source: "yandex",
          utm_campaign: "summer",
        },
      },
    };
    const send = () =>
      worker.fetch(
        new Request(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        env,
      );

    const accepted = await send();
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      ok: true,
      accepted: true,
      duplicate: false,
      projectId: "ARTHELLO",
      leadId: (
        await DB.prepare("SELECT id FROM front_office_leads LIMIT 1").first()
      ).id,
      route: "sales_manager_queue",
      outboundEnabled: false,
    });

    const duplicate = await send();
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const deniedList = await worker.fetch(
      new Request("https://control.example/api/front-office/leads"),
      env,
    );
    assert.equal(deniedList.status, 403);

    const list = await worker.fetch(
      ownerRequest("/api/front-office/leads"),
      env,
    );
    const leads = await list.json();
    assert.equal(leads.projectId, "ARTHELLO");
    assert.equal(leads.outboundEnabled, false);
    assert.equal(leads.rows.length, 1);
    assert.equal(leads.rows[0].phone, "+7 900 111-22-33");
    assert.equal(leads.rows[0].ownerRole, "SALES_MANAGER");
    assert.equal(
      leads.rows[0].messages[0].body,
      "Хотим подобрать программу рядом с домом.",
    );

    const leadId = leads.rows[0].id;
    const deniedUpdate = await worker.fetch(
      ownerRequest(`/api/front-office/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stage: "QUALIFIED",
          expectedVersion: 1,
        }),
      }),
      env,
    );
    assert.equal(deniedUpdate.status, 403);

    const updated = await worker.fetch(
      ownerRequest(`/api/front-office/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-arthello-action": "owner-confirmed",
        },
        body: JSON.stringify({
          stage: "QUALIFIED",
          ownerDisplayName: "Менеджер",
          nextAction: "Позвонить по заявке",
          nextActionAt: null,
          programInterest: "Подбор программы",
          expectedVersion: 1,
        }),
      }),
      env,
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).version, 2);

    const note = await worker.fetch(
      ownerRequest(`/api/front-office/leads/${leadId}/notes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-arthello-action": "owner-confirmed",
        },
        body: JSON.stringify({
          type: "internal_note",
          body: "Менеджер взял заявку в работу.",
        }),
      }),
      env,
    );
    assert.equal(note.status, 200);
    assert.equal((await note.json()).outboundEnabled, false);

    const refreshed = await worker.fetch(
      ownerRequest("/api/front-office/leads"),
      env,
    );
    const refreshedLead = (await refreshed.json()).rows[0];
    assert.equal(refreshedLead.stage, "QUALIFIED");
    assert.equal(refreshedLead.owner, "Менеджер");
    assert.equal(refreshedLead.version, 2);
    assert.equal(refreshedLead.messages.length, 2);

    const stored = await DB.prepare(
      `SELECT project_id, contact_point_masked, sealed_contact
       FROM front_office_conversations`,
    ).first();
    assert.equal(stored.project_id, "ARTHELLO");
    assert.match(stored.contact_point_masked, /2233$/);
    assert.match(stored.sealed_contact, /^v1\./);
    assert.doesNotMatch(stored.sealed_contact, /900 111|Тестовый/);

    const status = await worker.fetch(
      ownerRequest("/api/integrations/status"),
      env,
    );
    const statusPayload = await status.json();
    assert.equal(statusPayload.connectors.site.status, "active");
    assert.equal(statusPayload.connectors.site.eventCount, 1);
    assert.equal(
      statusPayload.connectors.site.externalAccountId,
      "arthello-webflow-site",
    );
    assert.equal(statusPayload.outboundEnabled, false);

    const crossSitePayload = structuredClone(payload);
    crossSitePayload.payload.id = "submission-2";
    crossSitePayload.payload.siteId = "another-webflow-site";
    const crossSite = await worker.fetch(
      new Request(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(crossSitePayload),
      }),
      env,
    );
    assert.equal(crossSite.status, 409);

    const schoolPayload = structuredClone(payload);
    schoolPayload.payload.id = "submission-school";
    schoolPayload.payload.name = "Заявка в школу 1–11";
    schoolPayload.payload.data.Направление = "Школа 1-11";
    const school = await worker.fetch(
      new Request(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schoolPayload),
      }),
      env,
    );
    assert.equal(school.status, 200);
    assert.equal((await school.json()).route, "school_1_11_queue");
    const schoolConversation = await DB.prepare(
      `SELECT owner_role, branch_or_object
       FROM front_office_conversations
       WHERE branch_or_object = 'SCHOOL_1_11_QUEUE'`,
    ).first();
    assert.equal(schoolConversation.owner_role, "SCHOOL_SUPPORT_ROUTER");
    assert.equal(schoolConversation.branch_or_object, "SCHOOL_1_11_QUEUE");
  } finally {
    DB.close();
  }
});

test("owner API is fail closed and snapshot import requires its separate secret", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  try {
    const unauthorized = await worker.fetch(
      new Request("https://control.example/api/owner-summary"),
      env,
    );
    assert.equal(unauthorized.status, 403);

    const rejectedImport = await worker.fetch(
      new Request(
        "https://control.example/api/admin/read-model/snapshot/begin",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
      env,
    );
    assert.equal(rejectedImport.status, 403);

    const legacyImport = await worker.fetch(
      new Request("https://control.example/api/admin/read-model/employees", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-arthello-import-token": env.ARTHELLO_IMPORT_TOKEN,
        },
        body: JSON.stringify({ replace: true, rows: [] }),
      }),
      env,
    );
    assert.equal(legacyImport.status, 410);

    const publication = await publishReadModelSnapshot(worker, env, {
      employees: [
        {
          id: "employee-1",
          full_name: "Контрольный сотрудник",
          primary_role: "Педагог",
          classification_status: "needs_review",
          source_kind: "owner_provided_payroll_roster",
          updated_at: "2026-07-25T00:00:00.000Z",
        },
      ],
    });
    assert.equal(publication.commit.status, 200);
    const committed = await publication.commit.json();
    assert.equal(committed.status, "active");
    assert.equal(committed.counts.employees, 1);

    const list = await worker.fetch(ownerRequest("/api/employees"), env);
    assert.equal(list.status, 200);
    const payload = await list.json();
    assert.equal(payload.total, 1);
    assert.equal(payload.rows[0].full_name, "Контрольный сотрудник");
    assert.equal(payload.dataMode, "real_owner_provided_source");
  } finally {
    DB.close();
  }
});

test("the sole Sites owner identity can read every protected control API", async () => {
  const DB = createD1();
  const env = testEnv(DB, {
    ARTHELLO_OWNER_EMAIL: "vitaliyozolin@gmail.com",
  });
  const protectedPaths = [
    "/api/owner-summary",
    "/api/employees",
    "/api/payroll?employee_id=missing",
    "/api/banking/tochka/status",
    "/api/integrations/status",
    "/api/front-office/leads",
  ];
  try {
    const legacyStatus = await worker.fetch(
      new Request("https://control.example/api/admin/read-model/status"),
      env,
    );
    const legacyPayload = await legacyStatus.json();
    assert.equal(legacyPayload.publication.activeBatchId, null);
    assert.equal(legacyPayload.publication.atomicSnapshot, false);
    assert.equal(
      legacyPayload.publication.attestationStatus,
      "legacy_unattested",
    );

    for (const path of protectedPaths) {
      const allowed = await worker.fetch(
        new Request(`https://control.example${path}`, {
          headers: {
            "oai-authenticated-user-email": "vitaliyozolin@gmail.com",
          },
        }),
        env,
      );
      assert.equal(allowed.status, 200, path);

      const foreign = await worker.fetch(
        new Request(`https://control.example${path}`, {
          headers: {
            "oai-authenticated-user-email": "someone@example.com",
          },
        }),
        env,
      );
      assert.equal(foreign.status, 403, path);

      const missing = await worker.fetch(
        new Request(`https://control.example${path}`),
        env,
      );
      assert.equal(missing.status, 403, path);
    }
  } finally {
    DB.close();
  }
});

test("aggregate machine status is non-sensitive and payroll evidence stays owner-only", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  try {
    const publication = await publishReadModelSnapshot(worker, env, {
      employee_payroll_components: [
        {
          id: "component-1",
          employee_id: "employee-1",
          period_month: "2026-07-01",
          legal_entity_name: "Контрольное юрлицо",
          component_key: "2026-07-01",
          source_label: "Оклад",
          amount: 100,
          amount_minor: 10000,
          quantity: 1,
          source_sheet: "Контроль",
          formula_present: 1,
          evidence_status: "imported_unverified",
          rule_activated: 0,
          updated_at: "2026-07-25T00:00:00.000Z",
        },
      ],
      employee_payroll_payments: [
        {
          id: "payment-1",
          employee_id: "employee-1",
          period_month: "2026-07-01",
          legal_entity_name: "Контрольное юрлицо",
          payment_date: "2026-07-25",
          amount: 90,
          amount_minor: 9000,
          payment_kind: "Зарплата",
          evidence_status: "imported_unverified",
          updated_at: "2026-07-25T00:00:00.000Z",
        },
      ],
    });
    assert.equal(publication.commit.status, 200);

    const machineStatus = await worker.fetch(
      new Request("https://control.example/api/admin/read-model/status"),
      env,
    );
    assert.equal(machineStatus.status, 200);
    const aggregate = await machineStatus.json();
    assert.equal(aggregate.dataMode, "aggregate_owner_control_status");
    assert.equal(aggregate.datasets.employee_payroll_components, 1);
    assert.equal(aggregate.datasets.employee_payroll_payments, 1);
    assert.equal(aggregate.publication.activeBatchId, publication.batchId);
    assert.equal(aggregate.publication.atomicSnapshot, true);
    assert.equal(aggregate.banking.paymentActionsEnabled, false);
    assert.deepEqual(aggregate.money, {
      storageMode: "integer_minor_units",
      scale: 2,
      financialCalculationsEnabled: false,
      missingMinorRows: 0,
      legacyReconciliationMismatches: 0,
    });
    assert.doesNotMatch(
      JSON.stringify(aggregate),
      /Контрольное юрлицо|Оклад|Зарплата|sealed_tokens|consent_id|current_balance/,
    );

    const denied = await worker.fetch(
      new Request("https://control.example/api/payroll?employee_id=employee-1"),
      env,
    );
    assert.equal(denied.status, 403);

    const payroll = await worker.fetch(
      ownerRequest("/api/payroll?employee_id=employee-1"),
      env,
    );
    const detail = await payroll.json();
    assert.equal(detail.components.length, 1);
    assert.equal(detail.payments.length, 1);
    assert.equal(detail.components[0].amount_minor, 10000);
    assert.equal(detail.payments[0].amount_minor, 9000);
    assert.equal(detail.money.storageMode, "integer_minor_units");
    assert.deepEqual(detail.taxCoverage, {
      status: "not_sourced",
      normalizedRows: 0,
      assumptionsApplied: false,
    });
  } finally {
    DB.close();
  }
});

test("snapshot commit rolls back every live dataset when one staged row is invalid", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  try {
    const initial = await publishReadModelSnapshot(worker, env, {
      employees: [
        {
          id: "employee-old",
          full_name: "Сохранённый сотрудник",
          primary_role: "Педагог",
          classification_status: "needs_review",
          source_kind: "owner_provided_payroll_roster",
          updated_at: "2026-07-25T00:00:00.000Z",
        },
      ],
    });
    assert.equal(initial.commit.status, 200);

    const invalid = await publishReadModelSnapshot(worker, env, {
      employees: [
        {
          id: "employee-new",
          full_name: null,
          primary_role: "Педагог",
          classification_status: "needs_review",
          source_kind: "owner_provided_payroll_roster",
          updated_at: "2026-07-26T00:00:00.000Z",
        },
      ],
    });
    assert.equal(invalid.commit.status, 500);

    const list = await worker.fetch(ownerRequest("/api/employees"), env);
    const payload = await list.json();
    assert.equal(payload.total, 1);
    assert.equal(payload.rows[0].id, "employee-old");

    const status = await worker.fetch(
      new Request("https://control.example/api/admin/read-model/status"),
      env,
    );
    const aggregate = await status.json();
    assert.equal(aggregate.publication.activeBatchId, initial.batchId);
    assert.equal(aggregate.datasets.employees, 1);
  } finally {
    DB.close();
  }
});

test("snapshot digest is computed from staged rows and preserves the previous active batch", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  try {
    const initial = await publishReadModelSnapshot(worker, env, {
      employees: [
        {
          id: "employee-old",
          full_name: "Сохранённый сотрудник",
          primary_role: "Педагог",
          classification_status: "needs_review",
          source_kind: "owner_provided_payroll_roster",
          updated_at: "2026-07-25T00:00:00.000Z",
        },
      ],
    });
    assert.equal(initial.commit.status, 200);
    const initialCommit = await initial.commit.json();
    assert.equal(initialCommit.payloadDigest, initial.manifest.payloadDigest);

    const intended = Object.fromEntries(
      readModelDatasetNames.map((dataset) => [dataset, []]),
    );
    intended.employees = [
      {
        id: "employee-new",
        full_name: "Ожидаемое имя",
        primary_role: "Педагог",
        classification_status: "needs_review",
        source_kind: "owner_provided_payroll_roster",
        updated_at: "2026-07-26T00:00:00.000Z",
      },
    ];
    const staged = structuredClone(intended);
    staged.employees[0].full_name = "Изменённое после manifest имя";
    const tampered = await publishReadModelSnapshot(worker, env, intended, {
      stagedDatasets: staged,
    });
    assert.equal(tampered.commit.status, 409);
    assert.equal(
      (await tampered.commit.json()).error,
      "SNAPSHOT_DATASET_DIGEST_MISMATCH",
    );

    const list = await worker.fetch(ownerRequest("/api/employees"), env);
    const employees = await list.json();
    assert.equal(employees.total, 1);
    assert.equal(employees.rows[0].id, "employee-old");

    const status = await worker.fetch(
      new Request("https://control.example/api/admin/read-model/status"),
      env,
    );
    const aggregate = await status.json();
    assert.equal(aggregate.publication.activeBatchId, initial.batchId);
    assert.equal(
      aggregate.publication.payloadDigest,
      initial.manifest.payloadDigest,
    );
    assert.equal(aggregate.publication.attestationStatus, "atomic_attested");
  } finally {
    DB.close();
  }
});

test("snapshot manifest rejects an arbitrary digest and missing staged dataset", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  const headers = {
    "content-type": "application/json",
    "x-arthello-import-token": env.ARTHELLO_IMPORT_TOKEN,
  };
  try {
    const datasets = Object.fromEntries(
      readModelDatasetNames.map((dataset) => [dataset, []]),
    );
    const manifest = testSnapshotManifest(datasets);
    const arbitrary = await worker.fetch(
      new Request(
        "https://control.example/api/admin/read-model/snapshot/begin",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            batchId: crypto.randomUUID(),
            payloadDigest: "a".repeat(64),
            expectedCounts: manifest.expectedCounts,
            expectedDigests: manifest.expectedDigests,
          }),
        },
      ),
      env,
    );
    assert.equal(arbitrary.status, 409);
    assert.equal((await arbitrary.json()).error, "SNAPSHOT_DIGEST_MISMATCH");

    const intended = structuredClone(datasets);
    intended.employees = [
      {
        id: "employee-not-staged",
        full_name: "Не должен попасть",
        primary_role: "Педагог",
        classification_status: "needs_review",
        source_kind: "owner_provided_payroll_roster",
        updated_at: "2026-07-26T00:00:00.000Z",
      },
    ];
    const staged = structuredClone(intended);
    delete staged.employees;
    const missing = await publishReadModelSnapshot(worker, env, intended, {
      stagedDatasets: staged,
    });
    assert.equal(missing.commit.status, 409);
    assert.equal(
      (await missing.commit.json()).error,
      "SNAPSHOT_COUNT_MISMATCH",
    );
  } finally {
    DB.close();
  }
});

test("snapshot digest is independent of row transfer order", async () => {
  const DB = createD1();
  const env = testEnv(DB);
  try {
    const rows = [
      {
        id: "employee-a",
        full_name: "Первый сотрудник",
        primary_role: "Педагог",
        classification_status: "needs_review",
        source_kind: "owner_provided_payroll_roster",
        updated_at: "2026-07-26T00:00:00.000Z",
      },
      {
        id: "employee-b",
        full_name: "Второй сотрудник",
        primary_role: "Администратор",
        classification_status: "needs_review",
        source_kind: "owner_provided_payroll_roster",
        updated_at: "2026-07-26T00:00:00.000Z",
      },
    ];
    const datasets = Object.fromEntries(
      readModelDatasetNames.map((dataset) => [dataset, []]),
    );
    datasets.employees = rows;
    const reversed = structuredClone(datasets);
    reversed.employees.reverse();
    assert.equal(
      testSnapshotManifest(datasets).payloadDigest,
      testSnapshotManifest(reversed).payloadDigest,
    );

    const publication = await publishReadModelSnapshot(worker, env, datasets, {
      stagedDatasets: reversed,
    });
    assert.equal(publication.commit.status, 200);
  } finally {
    DB.close();
  }
});

test("Tochka OAuth uses only read-only scopes, validates action, and seals tokens", async () => {
  const DB = createD1();
  const env = testEnv(DB, {
    TOCHKA_CLIENT_ID: "test-client",
    TOCHKA_CLIENT_SECRET: "test-secret",
    TOCHKA_OAUTH_REDIRECT_URI: "https://control.example/",
  });
  const realFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    providerCalls.push({ url: value, init });
    if (value.endsWith("/connect/token")) {
      const body = new URLSearchParams(init.body);
      if (body.get("grant_type") === "client_credentials") {
        return Response.json({
          access_token: "service-token",
          expires_in: 86400,
        });
      }
      return Response.json({
        access_token: "hybrid-token",
        refresh_token: "refresh-token",
        expires_in: 86400,
      });
    }
    if (value.endsWith("/v1.0/consents")) {
      return Response.json({ Data: { consentId: "consent-1" } });
    }
    if (value.endsWith("/open-banking/v1.0/customers")) {
      return Response.json({
        Data: {
          Customer: [
            {
              customerType: "Business",
              customerCode: "customer-a",
              shortName: "Организация А",
            },
            {
              customerType: "Business",
              customerCode: "customer-b",
              shortName: "Организация Б",
            },
          ],
        },
      });
    }
    if (value.endsWith("/open-banking/v1.0/accounts")) {
      const customer = new Headers(init.headers).get("customercode");
      return Response.json({
        Data: {
          Account: [
            {
              accountId: `${customer}/account`,
              accountNumber:
                customer === "customer-a"
                  ? "40702810000000000001"
                  : "40702810000000000002",
              accountName: "Основной",
            },
          ],
        },
      });
    }
    if (value.endsWith("/balances")) {
      const customer = new Headers(init.headers).get("customercode");
      return Response.json({
        Data: {
          Balance:
            customer === "customer-a"
              ? [
                  {
                    Type: "Expected",
                    Amount: { Amount: "77.00", Currency: "RUB" },
                    CreditDebitIndicator: "Debit",
                  },
                  {
                    Type: "ClosingAvailable",
                    Amount: { Amount: "1000.50", Currency: "RUB" },
                    CreditDebitIndicator: "Debit",
                  },
                ]
              : [
                  {
                    Type: "Expected",
                    Amount: { Amount: "77.00", Currency: "RUB" },
                    CreditDebitIndicator: "Debit",
                  },
                ],
        },
      });
    }
    throw new Error(`Unexpected provider URL: ${value}`);
  };

  try {
    const missingAction = await worker.fetch(
      ownerRequest("/api/banking/tochka/oauth/start", { method: "POST" }),
      env,
    );
    assert.equal(missingAction.status, 403);

    const started = await worker.fetch(
      ownerRequest("/api/banking/tochka/oauth/start", {
        method: "POST",
        headers: { "x-arthello-action": "owner-confirmed" },
      }),
      env,
    );
    assert.equal(started.status, 200);
    const startPayload = await started.json();
    const authorizeUrl = new URL(startPayload.authorizeUrl);
    assert.equal(
      authorizeUrl.searchParams.get("scope"),
      "accounts balances customers statements",
    );
    assert.doesNotMatch(authorizeUrl.searchParams.get("scope"), /payments|sbp/);
    const state = authorizeUrl.searchParams.get("state");
    assert.match(state, /^[a-f0-9]{48}$/);

    const consentCall = providerCalls.find((call) =>
      call.url.endsWith("/v1.0/consents"),
    );
    const consentBody = JSON.parse(consentCall.init.body);
    assert.deepEqual(consentBody.Data.permissions, [
      "ReadAccountsBasic",
      "ReadAccountsDetail",
      "ReadBalances",
      "ReadStatements",
      "ReadCustomerData",
    ]);

    const callback = await worker.fetch(
      new Request(
        `https://control.example/?code=authorization-code&state=${state}`,
      ),
      env,
    );
    assert.equal(callback.status, 303);
    assert.equal(
      new URL(callback.headers.get("location")).searchParams.get(
        "tochka_oauth",
      ),
      "success",
    );

    const status = await worker.fetch(
      ownerRequest("/api/banking/tochka/status"),
      env,
    );
    const statusPayload = await status.json();
    assert.equal(statusPayload.status, "active");
    assert.equal(statusPayload.accountCount, 2);
    assert.equal(statusPayload.paymentActionsEnabled, false);

    const accounts = await worker.fetch(
      ownerRequest("/api/banking/accounts"),
      env,
    );
    const accountPayload = await accounts.json();
    assert.equal(accountPayload.rows.length, 2);
    assert.equal(accountPayload.money.storageMode, "integer_minor_units");
    for (const account of accountPayload.rows) {
      assert.match(account.id, /^[a-f0-9]{64}$/);
      assert.match(account.masked_number, /^•••• 000[12]$/);
      assert.doesNotMatch(JSON.stringify(account), /4070281/);
    }
    const loaded = accountPayload.rows.find(
      (account) => account.masked_number === "•••• 0001",
    );
    const unavailable = accountPayload.rows.find(
      (account) => account.masked_number === "•••• 0002",
    );
    assert.equal(loaded.current_balance_minor, 100050);
    assert.equal(loaded.balance_status, "loaded");
    assert.equal(unavailable.current_balance_minor, null);
    assert.equal(unavailable.balance_status, "unavailable");

    const stored = await DB.prepare(
      "SELECT sealed_tokens, state_hash FROM bank_connector_state WHERE id = 'tochka'",
    ).first();
    assert.match(stored.sealed_tokens, /^v1\./);
    assert.equal(stored.state_hash, null);
    assert.doesNotMatch(stored.sealed_tokens, /hybrid-token|refresh-token/);
  } finally {
    globalThis.fetch = realFetch;
    DB.close();
  }
});

test("risk register and navigation cover the current owner-data gate", async () => {
  const response = await worker.fetch(new Request("https://control.example/"));
  const html = await response.text();
  const required = [
    "SEC-03",
    "SEC-08",
    "A4-13-01",
    "A4-13-02",
    "A4-13-03",
    "PAY-01",
    "BANK-01",
    "DATA-01",
    "Семьи",
    "Ученики",
    "Группы и классы",
    "Сотрудники",
    "Педагоги",
    "Зарплата",
    "Деньги",
    "ДДС",
    "ОПиУ",
    "Финансовая модель",
    "Система",
  ];
  for (const value of required) assert.match(html, new RegExp(value));
  assert.match(html, /2 593 raw-строк/);
  assert.match(html, /DATA SUITE PASS/);
  assert.doesNotMatch(html, /3 689 raw-строк/);
  assert.doesNotMatch(html, /Sites не принимает банковский код/);
});

test("money evidence is served and rendered through integer minor units", async () => {
  const [scriptSource, workerTemplate, schemaSource] = await Promise.all([
    readFile(resolve(import.meta.dirname, "../main.js"), "utf8"),
    readFile(
      resolve(import.meta.dirname, "../server/worker.template.js"),
      "utf8",
    ),
    readFile(resolve(projectRoot, "db/schema.ts"), "utf8"),
  ]);

  assert.match(scriptSource, /function formatMinorCurrency/);
  assert.match(scriptSource, /absolute % 100n/);
  assert.doesNotMatch(scriptSource, /maximumFractionDigits:\s*0/);
  assert.doesNotMatch(scriptSource, /moneyFormat\.format/);
  for (const field of [
    "accrued_amount_minor",
    "paid_amount_minor",
    "amount_minor",
    "rate_amount_minor",
    "current_balance_minor",
  ]) {
    assert.match(workerTemplate, new RegExp(field));
    assert.match(schemaSource, new RegExp(field));
  }
  assert.match(workerTemplate, /decimalTextToMinorUnits/);
  assert.match(workerTemplate, /money_precision_exceeds_cents/);
  assert.doesNotMatch(workerTemplate, /COALESCE\(\s*current_balance_minor/);
  assert.doesNotMatch(workerTemplate, /COALESCE\(\s*amount_minor,\s*CAST/);
  assert.doesNotMatch(
    workerTemplate,
    /COALESCE\(\s*accrued_amount_minor,\s*CAST/,
  );
});

test("navigation targets and mobile drawer have complete static contracts", async () => {
  const [htmlSource, scriptSource, styleSource] = await Promise.all([
    readFile(resolve(import.meta.dirname, "../index.html"), "utf8"),
    readFile(resolve(import.meta.dirname, "../main.js"), "utf8"),
    readFile(resolve(import.meta.dirname, "../styles.css"), "utf8"),
  ]);
  const sections = new Set(
    [...htmlSource.matchAll(/data-section="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  const directViews = new Set(
    [...htmlSource.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]),
  );
  const moduleKeys = new Set(
    [...scriptSource.matchAll(/^  ([a-z]+): \{$/gm)].map((match) => match[1]),
  );

  for (const target of [...htmlSource.matchAll(/data-go="([^"]+)"/g)].map(
    (match) => match[1],
  )) {
    assert.ok(
      sections.has(target) || directViews.has(target) || moduleKeys.has(target),
      `CTA target ${target} must resolve to a known view`,
    );
  }
  for (const required of [
    "pulse",
    "quality",
    "sources",
    "families",
    "students",
    "groups",
    "employees",
    "teachers",
    "payroll",
    "money",
    "cashflow",
    "pnl",
    "model",
    "system",
  ]) {
    assert.ok(sections.has(required), `missing navigation section ${required}`);
  }
  assert.match(htmlSource, /data-drawer-open/);
  assert.match(htmlSource, /data-drawer-close/);
  assert.match(scriptSource, /matchMedia\("\(max-width: 820px\)"\)/);
  assert.match(scriptSource, /aria-expanded/);
  assert.match(scriptSource, /event\.key === "Escape"/);
  assert.match(styleSource, /@media \(max-width: 820px\)/);
  assert.match(styleSource, /\.drawer-open \.sidebar/);
});

test("health is non-sensitive and unknown paths are rejected", async () => {
  const health = await worker.fetch(
    new Request("https://control.example/healthz"),
  );
  assert.deepEqual(await health.json(), {
    status: "ok",
    surface: "arthello-os-control",
    dataMode: "owner_only_read_model_with_real_inbound",
    outboundEnabled: false,
  });

  const missing = await worker.fetch(
    new Request("https://control.example/private-data"),
  );
  assert.equal(missing.status, 404);
});
