import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  operations,
  articles,
  contractorsTable,
  contractorAccrualsTable,
  contractorPaymentsTable,
  contractorDocumentsTable,
  taxObligationsTable,
  taxReserveTable,
  staffProfilesTable,
  staffBonusesTable,
} from "@workspace/db";

export const testDataRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthStr(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rand(min: number, max: number) {
  return Math.round(Math.random() * (max - min) + min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── GET /test-data/status ────────────────────────────────────────────────────

testDataRouter.get("/test-data/status", async (req, res) => {
  try {
    const [{ ops }] = await db
      .select({ ops: sql<number>`count(*)::int` })
      .from(operations)
      .where(eq(operations.isTestData, true));
    const [{ ctrs }] = await db
      .select({ ctrs: sql<number>`count(*)::int` })
      .from(contractorsTable)
      .where(eq(contractorsTable.isTestData, true));
    const [{ taxes }] = await db
      .select({ taxes: sql<number>`count(*)::int` })
      .from(taxObligationsTable)
      .where(eq(taxObligationsTable.isTestData, true));

    res.json({
      hasTestData: Number(ops) > 0 || Number(ctrs) > 0,
      operations: Number(ops),
      contractors: Number(ctrs),
      taxes: Number(taxes),
    });
  } catch (err) {
    req.log.error({ err }, "GET /test-data/status failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /test-data ────────────────────────────────────────────────────────

testDataRouter.delete("/test-data", async (req, res) => {
  try {
    const [{ ops }] = await db
      .delete(operations)
      .where(eq(operations.isTestData, true))
      .returning({ id: operations.id })
      .then((r) => [{ ops: r.length }]);
    const [{ ctrs }] = await db
      .delete(contractorsTable)
      .where(eq(contractorsTable.isTestData, true))
      .returning({ id: contractorsTable.id })
      .then((r) => [{ ctrs: r.length }]);
    const [{ taxes }] = await db
      .delete(taxObligationsTable)
      .where(eq(taxObligationsTable.isTestData, true))
      .returning({ id: taxObligationsTable.id })
      .then((r) => [{ taxes: r.length }]);
    await db
      .delete(taxReserveTable)
      .where(eq(taxReserveTable.isTestData, true));

    res.json({ deleted: { operations: ops, contractors: ctrs, taxes } });
  } catch (err) {
    req.log.error({ err }, "DELETE /test-data failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /test-data/seed ─────────────────────────────────────────────────────

testDataRouter.post("/test-data/seed", async (req, res) => {
  try {
    // Get existing article IDs
    const articleList = await db
      .select({
        id: articles.id,
        type: articles.type,
        name: articles.name,
        code: articles.code,
        groupName: articles.groupName,
      })
      .from(articles)
      .where(eq(articles.isActive, true));
    const incomeArticles = articleList.filter((a) => a.type === "income");
    const expenseArticles = articleList.filter((a) => a.type === "expense");

    const seededOps: string[] = [];

    // ── SEED OPERATIONS (Jan 2025 – May 2026) ─────────────────────────────────
    // 17 months × ~30 ops = ~510 operations

    for (let year = 2025; year <= 2026; year++) {
      const maxMonth = year === 2026 ? 5 : 12;
      for (let month = 1; month <= maxMonth; month++) {
        const cashM = monthStr(year, month);

        // Доходы: оплаты родителей (15–25 в месяц)
        const incomeCount = rand(15, 25);
        for (let i = 0; i < incomeCount; i++) {
          const day = rand(1, 28);
          const cashDate = new Date(year, month - 1, day);
          // Some payments are for next month (advance)
          const isAdvance = Math.random() < 0.15;
          const plM = isAdvance
            ? monthStr(
                month === 12 ? year + 1 : year,
                month === 12 ? 1 : month + 1,
              )
            : cashM;

          const art = incomeArticles.length > 0 ? pick(incomeArticles) : null;
          const amount = rand(8000, 45000);

          const [op] = await db
            .insert(operations)
            .values({
              operationType: "income",
              source: "crm_sync",
              direction: "in",
              amount: String(amount),
              currency: "RUB",
              description: isAdvance
                ? `Предоплата за ${plM} (ребёнок ${rand(1, 200)})`
                : `Оплата обучения ${cashM} (ребёнок ${rand(1, 200)})`,
              cashflowDate: cashDate,
              accrualDate: cashDate,
              cashflowMonth: cashM,
              plMonth: plM,
              articleId: art?.id ?? null,
              articleName: art?.name ?? "Оплата за обучение",
              articleCode: art?.code ?? "1.1",
              counterpartyName: `Семья ${rand(1, 200)}`,
              counterpartyType: "family",
              paymentStatus: "paid",
              verificationStatus: "verified",
              trustScore: 95,
              isTestData: true,
            })
            .returning({ id: operations.id });
          seededOps.push(op.id);
        }

        // Расходы: аренда (фиксированная)
        const rentArt =
          expenseArticles.find((a) => a.name.toLowerCase().includes("аренд")) ??
          expenseArticles[0];
        if (rentArt) {
          const [op] = await db
            .insert(operations)
            .values({
              operationType: "expense",
              source: "manual",
              direction: "out",
              amount: String(rand(180000, 220000)),
              currency: "RUB",
              description: `Аренда помещения ${cashM}`,
              cashflowDate: new Date(year, month - 1, 5),
              accrualDate: new Date(year, month - 1, 5),
              cashflowMonth: cashM,
              plMonth: cashM,
              articleId: rentArt.id,
              articleName: rentArt.name,
              articleCode: rentArt.code,
              counterpartyName: "ООО Арендодатель",
              counterpartyType: "contractor",
              paymentStatus: "paid",
              verificationStatus: "verified",
              trustScore: 100,
              isTestData: true,
            })
            .returning({ id: operations.id });
          seededOps.push(op.id);
        }

        // Расходы: ФОТ (1 запись на месяц)
        const payrollArt =
          expenseArticles.find(
            (a) =>
              a.name.toLowerCase().includes("зарплат") ||
              a.name.toLowerCase().includes("фот"),
          ) ?? expenseArticles[1];
        if (payrollArt) {
          const [op] = await db
            .insert(operations)
            .values({
              operationType: "payroll",
              source: "manual",
              direction: "out",
              amount: String(rand(350000, 500000)),
              currency: "RUB",
              description: `ФОТ педагоги ${cashM}`,
              cashflowDate: new Date(year, month - 1, 10),
              accrualDate: new Date(year, month - 1, 10),
              cashflowMonth: cashM,
              plMonth: cashM,
              articleId: payrollArt.id,
              articleName: payrollArt.name,
              articleCode: payrollArt.code,
              counterpartyType: "employee",
              paymentStatus: "paid",
              verificationStatus: "verified",
              trustScore: 100,
              isTestData: true,
            })
            .returning({ id: operations.id });
          seededOps.push(op.id);
        }

        // Расходы: маркетинг (2–4 в месяц)
        const mktgArt =
          expenseArticles.find(
            (a) =>
              a.name.toLowerCase().includes("маркет") ||
              a.name.toLowerCase().includes("реклам"),
          ) ?? expenseArticles[2];
        if (mktgArt) {
          const mktgCount = rand(2, 4);
          for (let i = 0; i < mktgCount; i++) {
            const [op] = await db
              .insert(operations)
              .values({
                operationType: "expense",
                source: "manual",
                direction: "out",
                amount: String(rand(5000, 35000)),
                currency: "RUB",
                description: `${pick(["ВКонтакте", "Яндекс", "Instagram", "Telegram"])} реклама`,
                cashflowDate: new Date(year, month - 1, rand(1, 28)),
                accrualDate: new Date(year, month - 1, rand(1, 28)),
                cashflowMonth: cashM,
                plMonth: cashM,
                articleId: mktgArt.id,
                articleName: mktgArt.name,
                articleCode: mktgArt.code,
                counterpartyType: "contractor",
                paymentStatus: "paid",
                verificationStatus: "unverified",
                trustScore: 70,
                isTestData: true,
              })
              .returning({ id: operations.id });
            seededOps.push(op.id);
          }
        }

        // Расходы: налоги (1 раз в квартал)
        if (month % 3 === 1) {
          const taxArt =
            expenseArticles.find((a) =>
              a.name.toLowerCase().includes("налог"),
            ) ?? expenseArticles[3];
          if (taxArt) {
            const [op] = await db
              .insert(operations)
              .values({
                operationType: "tax",
                source: "manual",
                direction: "out",
                amount: String(rand(40000, 90000)),
                currency: "RUB",
                description: `УСН квартал Q${Math.ceil(month / 3)} ${year}`,
                cashflowDate: new Date(year, month - 1, 25),
                accrualDate: new Date(year, month - 1, 25),
                cashflowMonth: cashM,
                plMonth: cashM,
                articleId: taxArt.id,
                articleName: taxArt.name,
                articleCode: taxArt.code,
                counterpartyName: "ФНС",
                counterpartyType: "tax",
                paymentStatus: "paid",
                verificationStatus: "verified",
                trustScore: 100,
                isTestData: true,
              })
              .returning({ id: operations.id });
            seededOps.push(op.id);
          }
        }

        // Прочие расходы: питание, IT, коммунальные
        const miscExpenses = [
          { name: "Питание воспитанников", amount: [30000, 70000] },
          { name: "IT и программное обеспечение", amount: [5000, 15000] },
          { name: "Коммунальные услуги", amount: [15000, 35000] },
        ];
        for (const misc of miscExpenses) {
          const art =
            expenseArticles.find((a) =>
              a.name
                .toLowerCase()
                .includes(misc.name.split(" ")[0].toLowerCase()),
            ) ?? pick(expenseArticles);
          const [op] = await db
            .insert(operations)
            .values({
              operationType: "expense",
              source: "manual",
              direction: "out",
              amount: String(rand(misc.amount[0], misc.amount[1])),
              currency: "RUB",
              description: `${misc.name} ${cashM}`,
              cashflowDate: new Date(year, month - 1, rand(5, 25)),
              accrualDate: new Date(year, month - 1, rand(5, 25)),
              cashflowMonth: cashM,
              plMonth: cashM,
              articleId: art.id,
              articleName: art.name,
              articleCode: art.code,
              counterpartyType: "contractor",
              paymentStatus: "paid",
              verificationStatus:
                Math.random() < 0.3 ? "unverified" : "verified",
              trustScore: rand(60, 100),
              isTestData: true,
            })
            .returning({ id: operations.id });
          seededOps.push(op.id);
        }
      }
    }

    // ── SEED CONTRACTORS (10) ──────────────────────────────────────────────────

    const contractorSeeds = [
      {
        name: "ООО АртСтудия",
        inn: "7701234567",
        type: "ooo",
        taxStatus: "osno",
        riskLevel: "low",
        trustScore: 90,
      },
      {
        name: "ИП Петрова Е.А.",
        inn: "771234567890",
        type: "ip",
        taxStatus: "usn",
        riskLevel: "low",
        trustScore: 85,
      },
      {
        name: "Самозанятый Иванов",
        inn: "771987654321",
        type: "self_employed",
        taxStatus: "npd",
        riskLevel: "medium",
        trustScore: 65,
      },
      {
        name: "ООО ЦифровойМир",
        inn: "7709876543",
        type: "ooo",
        taxStatus: "usn",
        riskLevel: "low",
        trustScore: 80,
      },
      {
        name: "ИП Сидоров В.Б.",
        inn: "772345678901",
        type: "ip",
        taxStatus: "usn",
        riskLevel: "medium",
        trustScore: 55,
      },
      {
        name: "ООО КлинингПро",
        inn: "7703456789",
        type: "ooo",
        taxStatus: "osno",
        riskLevel: "low",
        trustScore: 75,
      },
      {
        name: "ИП Козлова Н.В.",
        inn: "773456789012",
        type: "ip",
        taxStatus: "usn",
        riskLevel: "high",
        trustScore: 30,
      },
      {
        name: "ООО МедиаГрупп",
        inn: "7705678901",
        type: "ooo",
        taxStatus: "osno",
        riskLevel: "medium",
        trustScore: 70,
      },
      {
        name: "Самозанятый Федоров",
        inn: "774567890123",
        type: "self_employed",
        taxStatus: "npd",
        riskLevel: "medium",
        trustScore: 60,
      },
      {
        name: "ООО ЭкоПитание",
        inn: "7706789012",
        type: "ooo",
        taxStatus: "usn",
        riskLevel: "low",
        trustScore: 88,
      },
    ];

    for (const c of contractorSeeds) {
      const [contractor] = await db
        .insert(contractorsTable)
        .values({
          ...c,
          paymentTerms: pick(["net30", "prepaid", "on_act"]),
          direction: pick(["Атлас", "Все филиалы"]),
          responsible: pick(["Директор", "Бухгалтер", "Администратор"]),
          notes: `Тестовый подрядчик (${c.type})`,
          isTestData: true,
        })
        .returning();

      // 2–4 accruals per contractor
      const accrualCount = rand(2, 4);
      for (let i = 0; i < accrualCount; i++) {
        const year = pick([2025, 2025, 2026]);
        const month = rand(1, year === 2026 ? 5 : 12);
        const amount = rand(15000, 150000);
        const accrualMonth = monthStr(year, month);

        const [accrual] = await db
          .insert(contractorAccrualsTable)
          .values({
            contractorId: contractor.id,
            amount: String(amount),
            accrualDate: dateStr(year, month, rand(1, 25)),
            accrualMonth,
            description: `Начисление по договору ${rand(100, 999)}`,
            status: pick(["approved", "approved", "paid", "pending"]),
            isTestData: true,
          })
          .returning();

        // 0–1 payments per accrual
        if (Math.random() < 0.75) {
          const paidAmt =
            Math.random() < 0.9
              ? amount
              : rand(Math.floor(amount * 0.4), amount - 1000);
          await db.insert(contractorPaymentsTable).values({
            contractorId: contractor.id,
            accrualId: accrual.id,
            amount: String(paidAmt),
            paymentDate: dateStr(
              year,
              month,
              rand(accrual.accrualDate ? 1 : 1, 28),
            ),
            paymentMonth: accrualMonth,
            method: "bank",
            isTestData: true,
          });
        }

        // 0–1 documents per accrual
        if (Math.random() < 0.7) {
          await db.insert(contractorDocumentsTable).values({
            contractorId: contractor.id,
            accrualId: accrual.id,
            docType: pick(["act", "act", "invoice", "upd"]),
            docNumber: `${rand(100, 999)}`,
            docDate: dateStr(year, month, rand(1, 28)),
            amount: String(amount),
            status: pick(["received", "received", "signed", "expected"]),
            isTestData: true,
          });
        }
      }
    }

    // ── SEED TAXES ────────────────────────────────────────────────────────────

    const taxTypes: Array<{
      taxType: string;
      taxName: string;
      rate: number;
      quarterOnly?: boolean;
    }> = [
      { taxType: "usn", taxName: "УСН 6%", rate: 0.06, quarterOnly: true },
      { taxType: "ndfl", taxName: "НДФЛ с ФОТ", rate: 0.13 },
      { taxType: "pfr", taxName: "Страховые взносы ПФР", rate: 0.22 },
      { taxType: "fss", taxName: "ФСС", rate: 0.029 },
    ];

    for (let year = 2025; year <= 2026; year++) {
      const maxMonth = year === 2026 ? 5 : 12;
      for (let month = 1; month <= maxMonth; month++) {
        const periodMonth = monthStr(year, month);
        const revenue = rand(400000, 700000);

        for (const t of taxTypes) {
          if (t.quarterOnly && month % 3 !== 0) continue;

          const base = t.taxType === "usn" ? revenue * 3 : rand(300000, 500000);
          const accrued = Math.round(base * t.rate);
          const isPaid = year < 2026 || month < 4;
          const dueMonth = month + 1 > 12 ? 1 : month + 1;
          const dueYear = month + 1 > 12 ? year + 1 : year;

          await db.insert(taxObligationsTable).values({
            taxType: t.taxType,
            taxName: t.taxName,
            periodMonth,
            dueDate: dateStr(dueYear, dueMonth, 25),
            taxBase: String(Math.round(base)),
            taxRate: String(t.rate),
            accruedAmount: String(accrued),
            paidAmount: isPaid ? String(accrued) : "0",
            status: isPaid ? "paid" : month < maxMonth ? "accrued" : "accrued",
            isTestData: true,
          });
        }

        // Tax reserve
        const reserveAmt = rand(60000, 120000);
        await db
          .insert(taxReserveTable)
          .values({
            periodMonth,
            reserveAmount: String(reserveAmt),
            isTestData: true,
          })
          .onConflictDoUpdate({
            target: taxReserveTable.periodMonth,
            set: {
              reserveAmount: String(reserveAmt),
              isTestData: true,
              updatedAt: new Date(),
            },
          });
      }
    }

    // ── SEED STAFF PROFILES (30 employees) ────────────────────────────────────

    const positions = [
      "Педагог",
      "Старший педагог",
      "Методист",
      "Администратор",
      "Помощник педагога",
      "Завуч",
    ];
    const departments = [
      "Art",
      "Music",
      "Dance",
      "Language",
      "Math",
      "Science",
      "Drama",
    ];
    const hireDates = [
      "2020-09-01",
      "2021-01-15",
      "2021-03-10",
      "2021-06-01",
      "2022-01-09",
      "2022-04-05",
      "2022-08-15",
      "2023-01-09",
      "2023-03-01",
      "2023-09-01",
    ];

    const staffSeeds = [
      "Иванова Мария Петровна",
      "Петров Алексей Сергеевич",
      "Сидорова Елена Викторовна",
      "Козлов Дмитрий Игоревич",
      "Новикова Анна Александровна",
      "Михайлов Сергей Юрьевич",
      "Фёдорова Ольга Николаевна",
      "Соколов Иван Михайлович",
      "Попова Татьяна Владимировна",
      "Лебедев Андрей Константинович",
      "Смирнова Наталья Ивановна",
      "Волков Роман Андреевич",
      "Зайцева Ксения Олеговна",
      "Морозов Павел Денисович",
      "Орлова Светлана Евгеньевна",
      "Николаев Антон Викторович",
      "Семёнова Ирина Сергеевна",
      "Голубев Кирилл Алексеевич",
      "Виноградова Дарья Петровна",
      "Богданов Максим Романович",
      "Кузнецова Юлия Игоревна",
      "Медведев Илья Дмитриевич",
      "Захарова Людмила Николаевна",
      "Коновалов Артём Михайлович",
      "Пономарёва Валерия Андреевна",
      "Тихонов Степан Юрьевич",
      "Крылова Надежда Олеговна",
      "Беляев Владислав Константинович",
      "Тарасова Вероника Павловна",
      "Громов Евгений Сергеевич",
    ];

    const seededStaff: string[] = [];

    for (let i = 0; i < staffSeeds.length; i++) {
      const teacherCrmId = `TEST-TEACHER-${String(i + 1).padStart(3, "0")}`;
      const department = pick(departments);
      const position = pick(positions);
      const hireDate = pick(hireDates);
      const kpiTarget = rand(40, 80);

      // Upsert to avoid conflicts on re-seed
      const [profile] = await db
        .insert(staffProfilesTable)
        .values({
          teacherCrmId,
          position,
          department,
          hireDate,
          ndflRate: "0.13",
          pfrRate: "0.22",
          fssRate: "0.029",
          kpiTarget: String(kpiTarget),
          isActive: Math.random() < 0.9,
          notes: `Тестовый педагог — ${staffSeeds[i]}`,
        })
        .onConflictDoUpdate({
          target: staffProfilesTable.teacherCrmId,
          set: {
            position,
            department,
            hireDate,
            notes: `Тестовый педагог — ${staffSeeds[i]}`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: staffProfilesTable.id });

      seededStaff.push(profile.id);

      // Bonuses for some staff (3–6 months each)
      if (Math.random() < 0.7) {
        const bonusMonths = rand(2, 6);
        for (let b = 0; b < bonusMonths; b++) {
          const bYear = pick([2025, 2025, 2026]);
          const bMonth = rand(1, bYear === 2026 ? 5 : 12);
          const bPeriod = monthStr(bYear, bMonth);
          await db
            .insert(staffBonusesTable)
            .values({
              teacherCrmId,
              periodMonth: bPeriod,
              amount: String(rand(2000, 15000)),
              reason: pick([
                "Выполнение KPI",
                "Наставничество",
                "Доп. нагрузка",
                "Праздничная премия",
                "За дополнительные занятия",
              ]),
              status: pick(["paid", "paid", "paid", "pending"]),
            })
            .onConflictDoNothing();
        }
      }
    }

    // ── SEED SPLIT-PERIOD OPERATIONS (cross-month examples) ────────────────────
    // Payments in August for September (advance for next month)

    const splitExamples = [
      {
        cashM: "2025-08",
        plM: "2025-09",
        desc: "Предоплата за сентябрь (семья Ковалёвых)",
        amount: 28000,
      },
      {
        cashM: "2025-11",
        plM: "2025-12",
        desc: "Предоплата за декабрь (семья Романовых)",
        amount: 35000,
      },
      {
        cashM: "2025-12",
        plM: "2026-01",
        desc: "Предоплата за январь 2026 (семья Орловых)",
        amount: 31000,
      },
      {
        cashM: "2026-02",
        plM: "2026-03",
        desc: "Предоплата за март (семья Лебедевых)",
        amount: 24000,
      },
      {
        cashM: "2026-04",
        plM: "2026-06",
        desc: "Аренда оплачена авансом на 2 мес.",
        amount: 400000,
      },
      {
        cashM: "2025-09",
        plM: "2025-10",
        desc: "Сервис оплачен за 2 месяца (IT)",
        amount: 14000,
      },
    ];

    for (const ex of splitExamples) {
      const [y, m] = ex.cashM.split("-").map(Number);
      const art = incomeArticles.length > 0 ? pick(incomeArticles) : null;
      await db.insert(operations).values({
        operationType: ex.amount > 100000 ? "expense" : "income",
        source: "manual",
        direction: ex.amount > 100000 ? "out" : "in",
        amount: String(ex.amount),
        currency: "RUB",
        description: ex.desc,
        cashflowDate: new Date(y, m - 1, rand(25, 28)),
        accrualDate: new Date(y, m - 1, rand(25, 28)),
        cashflowMonth: ex.cashM,
        plMonth: ex.plM,
        articleId: art?.id ?? null,
        articleName:
          ex.amount > 100000 ? "Аренда" : (art?.name ?? "Оплата за обучение"),
        articleCode: ex.amount > 100000 ? "2.1" : (art?.code ?? "1.1"),
        counterpartyName:
          ex.amount > 100000 ? "ООО Арендодатель" : `Семья тест`,
        counterpartyType: ex.amount > 100000 ? "contractor" : "family",
        paymentStatus: "paid",
        verificationStatus: "verified",
        trustScore: 90,
        isTestData: true,
        notes: `Split-period: ДДС=${ex.cashM}, ОПиУ=${ex.plM}`,
      });
    }

    res.json({
      seeded: {
        operations: seededOps.length + splitExamples.length,
        contractors: contractorSeeds.length,
        taxes: "multi-month",
        staff: seededStaff.length,
        splitPeriodExamples: splitExamples.length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "POST /test-data/seed failed");
    res.status(500).json({ error: "Internal error" });
  }
});
