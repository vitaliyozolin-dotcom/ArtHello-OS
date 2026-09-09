import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod/v4";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  frontOfficeAuditEventsTable,
  frontOfficeConversationsTable,
  frontOfficeLeadsTable,
  frontOfficeMessagesTable,
  frontOfficeTasksTable,
  type FrontOfficeLead,
} from "@workspace/db";
import {
  FRONT_OFFICE_MODE,
  FRONT_OFFICE_PROJECT_ID,
  assertInternalMessageType,
  assertLeadStageTransition,
  assertSyntheticWriteAllowed,
  parseLeadStage,
  safeLimit,
  stageRequiresNextAction,
  type LeadStage,
} from "../../lib/front-office-policy.js";

export const frontOfficeRouter = Router();

interface SessionActor {
  role: string;
  name: string;
}

const createLeadSchema = z.object({
  clientRequestId: z.string().uuid(),
  contactDisplayName: z.string().trim().min(1).max(120),
  contactPointMasked: z.string().trim().max(80).optional(),
  channel: z.enum(["internal", "site", "phone", "email", "messenger"]),
  source: z.string().trim().max(120).optional(),
  intent: z.string().trim().max(160).optional(),
  childAgeBand: z.string().trim().max(40).optional(),
  branchPreference: z.string().trim().max(120).optional(),
  programInterest: z.string().trim().max(160).optional(),
  ownerDisplayName: z.string().trim().min(1).max(120),
  nextAction: z.string().trim().min(1).max(300),
  nextActionAt: z.string().datetime(),
  initialMessage: z.string().trim().max(2_000).optional(),
});

const updateLeadSchema = z
  .object({
    version: z.number().int().positive(),
    stage: z
      .enum([
        "NEW",
        "QUALIFIED",
        "PROGRAM_MATCHED",
        "TRIAL_REQUESTED",
        "TRIAL_CONFIRMED",
        "WON",
        "LOST",
      ])
      .optional(),
    ownerDisplayName: z.string().trim().min(1).max(120).optional(),
    nextAction: z.string().trim().max(300).nullable().optional(),
    nextActionAt: z.string().datetime().nullable().optional(),
    branchPreference: z.string().trim().max(120).nullable().optional(),
    programInterest: z.string().trim().max(160).nullable().optional(),
    trialStatus: z
      .enum([
        "not_requested",
        "requested",
        "confirmed",
        "completed",
        "cancelled",
      ])
      .optional(),
    trialAt: z.string().datetime().nullable().optional(),
    lossReason: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

const createNoteSchema = z
  .object({
    messageType: z.enum(["internal_note", "ai_draft"]),
    body: z.string().trim().min(1).max(2_000),
    factStatus: z
      .enum(["VERIFIED", "PARTIAL", "UNVERIFIED", "CONFLICT", "STALE"])
      .default("UNVERIFIED"),
    sourceRefs: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  })
  .strict();

const updateTaskSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["open", "done", "cancelled"]),
  })
  .strict();

function internalAlphaEnabled(): boolean {
  if (process.env.FRONT_OFFICE_INTERNAL_ALPHA_ENABLED === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function requireInternalAlpha(res: Response): boolean {
  if (internalAlphaEnabled()) return true;
  res.status(423).json({
    error: "Внутренняя альфа Front Office отключена",
    code: "FRONT_OFFICE_INTERNAL_ALPHA_DISABLED",
  });
  return false;
}

function actorFromResponse(res: Response): SessionActor {
  const auth = res.locals.auth as
    { session?: { role?: unknown; name?: unknown } } | undefined;
  return {
    role:
      typeof auth?.session?.role === "string"
        ? auth.session.role
        : "authenticated",
    name:
      typeof auth?.session?.name === "string" ? auth.session.name : "Сотрудник",
  };
}

function requestIdFromResponse(res: Response): string | null {
  const requestId = res.req.id;
  return requestId === undefined ? null : String(requestId);
}

function dateOrNull(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function cleanAuditLead(lead: FrontOfficeLead): Record<string, unknown> {
  return {
    id: lead.id,
    conversationId: lead.conversationId,
    stage: lead.stage,
    branchPreference: lead.branchPreference,
    programInterest: lead.programInterest,
    ownerDisplayName: lead.ownerDisplayName,
    nextAction: lead.nextAction,
    nextActionAt: lead.nextActionAt,
    trialStatus: lead.trialStatus,
    trialAt: lead.trialAt,
    lossReason: lead.lossReason,
    version: lead.version,
    isSynthetic: lead.isSynthetic,
  };
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  res: Response,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
  },
): Promise<void> {
  const actor = actorFromResponse(res);
  await tx.insert(frontOfficeAuditEventsTable).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorRole: actor.role,
    actorDisplayName: actor.name,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    requestId: requestIdFromResponse(res),
  });
}

function handleRouteError(
  res: Response,
  error: unknown,
  fallback: string,
): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: "Некорректные данные",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  if (error instanceof Error) {
    const safeClientErrors = [
      "Недопустимый переход",
      "Внутренняя альфа",
      "Исходящие сообщения",
      "Неизвестный этап",
      "Для активного лида",
      "Для потерянного лида",
      "Запись уже изменилась",
    ];
    if (safeClientErrors.some((prefix) => error.message.startsWith(prefix))) {
      res.status(409).json({ error: error.message });
      return;
    }
  }
  res.status(500).json({ error: fallback });
}

frontOfficeRouter.get("/front-office/health", (_req, res) => {
  res.json({
    projectId: FRONT_OFFICE_PROJECT_ID,
    mode: FRONT_OFFICE_MODE,
    internalAlphaEnabled: internalAlphaEnabled(),
    persistence: "postgres",
    liveIngressEnabled: false,
    outboundEnabled: false,
    financialActionsEnabled: false,
  });
});

frontOfficeRouter.get("/front-office/workspace", async (req, res) => {
  if (!requireInternalAlpha(res)) return;

  try {
    const limit = safeLimit(req.query.limit, 100, 200);
    const [conversations, leads, messages, tasks, events] = await Promise.all([
      db
        .select()
        .from(frontOfficeConversationsTable)
        .where(eq(frontOfficeConversationsTable.isSynthetic, true))
        .orderBy(desc(frontOfficeConversationsTable.lastMessageAt))
        .limit(limit),
      db
        .select()
        .from(frontOfficeLeadsTable)
        .where(eq(frontOfficeLeadsTable.isSynthetic, true))
        .orderBy(desc(frontOfficeLeadsTable.updatedAt))
        .limit(limit),
      db
        .select()
        .from(frontOfficeMessagesTable)
        .where(eq(frontOfficeMessagesTable.isSynthetic, true))
        .orderBy(asc(frontOfficeMessagesTable.createdAt))
        .limit(limit * 10),
      db
        .select()
        .from(frontOfficeTasksTable)
        .where(eq(frontOfficeTasksTable.isSynthetic, true))
        .orderBy(asc(frontOfficeTasksTable.dueAt))
        .limit(limit * 3),
      db
        .select()
        .from(frontOfficeAuditEventsTable)
        .orderBy(desc(frontOfficeAuditEventsTable.createdAt))
        .limit(100),
    ]);

    const leadByConversation = new Map(
      leads.map((lead) => [lead.conversationId, lead]),
    );
    const messagesByConversation = new Map<string, typeof messages>();
    for (const message of messages) {
      const list = messagesByConversation.get(message.conversationId) ?? [];
      list.push(message);
      messagesByConversation.set(message.conversationId, list);
    }

    const openTasks = tasks.filter((task) => task.status === "open");
    const now = Date.now();
    const stageCounts = Object.fromEntries(
      [
        "NEW",
        "QUALIFIED",
        "PROGRAM_MATCHED",
        "TRIAL_REQUESTED",
        "TRIAL_CONFIRMED",
        "WON",
        "LOST",
      ].map((stage) => [
        stage,
        leads.filter((lead) => lead.stage === stage).length,
      ]),
    );

    res.json({
      contract: {
        projectId: FRONT_OFFICE_PROJECT_ID,
        mode: FRONT_OFFICE_MODE,
        dataClass: "SYNTHETIC_ONLY",
        persistence: "postgres",
        liveIngressEnabled: false,
        outboundEnabled: false,
        financialActionsEnabled: false,
      },
      stats: {
        totalLeads: leads.length,
        activeLeads: leads.filter(
          (lead) => lead.stage !== "WON" && lead.stage !== "LOST",
        ).length,
        wonLeads: Number(stageCounts.WON ?? 0),
        unassignedLeads: leads.filter((lead) => !lead.ownerDisplayName).length,
        overdueTasks: openTasks.filter((task) => task.dueAt.getTime() < now)
          .length,
        stageCounts,
      },
      conversations: conversations.map((conversation) => ({
        ...conversation,
        lead: leadByConversation.get(conversation.id) ?? null,
        messages: messagesByConversation.get(conversation.id) ?? [],
      })),
      tasks,
      auditEvents: events,
    });
  } catch (error) {
    req.log.error({ error }, "GET /front-office/workspace failed");
    handleRouteError(res, error, "Не удалось загрузить Front Office");
  }
});

frontOfficeRouter.post("/front-office/leads", async (req, res) => {
  if (!requireInternalAlpha(res)) return;

  try {
    const input = createLeadSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const externalKey = `internal-alpha:${input.clientRequestId}`;
      const [existing] = await tx
        .select()
        .from(frontOfficeConversationsTable)
        .where(
          and(
            eq(
              frontOfficeConversationsTable.projectId,
              FRONT_OFFICE_PROJECT_ID,
            ),
            eq(frontOfficeConversationsTable.externalKey, externalKey),
          ),
        )
        .limit(1);

      if (existing) {
        const [lead] = await tx
          .select()
          .from(frontOfficeLeadsTable)
          .where(eq(frontOfficeLeadsTable.conversationId, existing.id))
          .limit(1);
        return { conversation: existing, lead, created: false };
      }

      const nextActionAt = new Date(input.nextActionAt);
      const [conversation] = await tx
        .insert(frontOfficeConversationsTable)
        .values({
          projectId: FRONT_OFFICE_PROJECT_ID,
          externalKey,
          kind: "lead",
          channel: input.channel,
          status: "open",
          priority: "P3",
          contactDisplayName: input.contactDisplayName,
          contactPointMasked: input.contactPointMasked ?? null,
          identityStatus: "not_required",
          intent: input.intent ?? null,
          branchOrObject: input.branchPreference ?? null,
          ownerRole: "SALES_MANAGER",
          ownerDisplayName: input.ownerDisplayName,
          nextActionAt,
          isSynthetic: true,
        })
        .returning();

      const [lead] = await tx
        .insert(frontOfficeLeadsTable)
        .values({
          conversationId: conversation.id,
          stage: "NEW",
          source: input.source ?? "internal",
          childAgeBand: input.childAgeBand ?? null,
          branchPreference: input.branchPreference ?? null,
          programInterest: input.programInterest ?? null,
          ownerDisplayName: input.ownerDisplayName,
          nextAction: input.nextAction,
          nextActionAt,
          isSynthetic: true,
        })
        .returning();

      if (input.initialMessage) {
        await tx.insert(frontOfficeMessagesTable).values({
          conversationId: conversation.id,
          messageType: "incoming",
          direction: "incoming",
          body: input.initialMessage,
          authorRole: "synthetic_customer",
          authorDisplayName: input.contactDisplayName,
          factStatus: "UNVERIFIED",
          isSynthetic: true,
        });
      }

      await tx.insert(frontOfficeTasksTable).values({
        conversationId: conversation.id,
        leadId: lead.id,
        title: input.nextAction,
        ownerRole: "SALES_MANAGER",
        ownerDisplayName: input.ownerDisplayName,
        priority: "P3",
        status: "open",
        dueAt: nextActionAt,
        isSynthetic: true,
      });

      await audit(tx, res, {
        entityType: "lead",
        entityId: lead.id,
        action: "created",
        afterState: cleanAuditLead(lead),
      });

      return { conversation, lead, created: true };
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    req.log.error({ error }, "POST /front-office/leads failed");
    handleRouteError(res, error, "Не удалось создать тестовый лид");
  }
});

frontOfficeRouter.patch("/front-office/leads/:id", async (req, res) => {
  if (!requireInternalAlpha(res)) return;

  try {
    const input = updateLeadSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(frontOfficeLeadsTable)
        .where(eq(frontOfficeLeadsTable.id, req.params.id))
        .limit(1);
      if (!current) return null;

      assertSyntheticWriteAllowed(current);

      const currentStage = parseLeadStage(current.stage);
      const nextStage = input.stage ?? currentStage;
      assertLeadStageTransition(currentStage, nextStage);

      const effectiveOwner =
        input.ownerDisplayName ?? current.ownerDisplayName ?? null;
      const effectiveNextAction =
        input.nextAction === undefined ? current.nextAction : input.nextAction;
      const effectiveNextActionAt =
        input.nextActionAt === undefined
          ? current.nextActionAt
          : dateOrNull(input.nextActionAt);
      const effectiveLossReason =
        input.lossReason === undefined ? current.lossReason : input.lossReason;

      if (
        stageRequiresNextAction(nextStage) &&
        (!effectiveOwner || !effectiveNextAction || !effectiveNextActionAt)
      ) {
        throw new Error(
          "Для активного лида обязательны ответственный, следующий шаг и срок",
        );
      }
      if (nextStage === "LOST" && !effectiveLossReason) {
        throw new Error("Для потерянного лида обязательна причина отказа");
      }

      const update = {
        stage: nextStage,
        ownerDisplayName: effectiveOwner,
        nextAction: effectiveNextAction,
        nextActionAt: effectiveNextActionAt,
        branchPreference:
          input.branchPreference === undefined
            ? current.branchPreference
            : input.branchPreference,
        programInterest:
          input.programInterest === undefined
            ? current.programInterest
            : input.programInterest,
        trialStatus: input.trialStatus ?? current.trialStatus,
        trialAt:
          input.trialAt === undefined
            ? current.trialAt
            : dateOrNull(input.trialAt),
        lossReason: effectiveLossReason,
        wonAt:
          nextStage === "WON" && current.stage !== "WON"
            ? new Date()
            : current.wonAt,
        version: current.version + 1,
        updatedAt: new Date(),
      };

      const [updated] = await tx
        .update(frontOfficeLeadsTable)
        .set(update)
        .where(
          and(
            eq(frontOfficeLeadsTable.id, current.id),
            eq(frontOfficeLeadsTable.version, input.version),
          ),
        )
        .returning();

      if (!updated) {
        throw new Error(
          "Запись уже изменилась другим сотрудником. Обновите данные",
        );
      }

      await tx
        .update(frontOfficeConversationsTable)
        .set({
          ownerDisplayName: updated.ownerDisplayName,
          nextActionAt: updated.nextActionAt,
          status:
            nextStage === "WON" || nextStage === "LOST" ? "resolved" : "open",
          version: sql`${frontOfficeConversationsTable.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(frontOfficeConversationsTable.id, current.conversationId));

      if (
        updated.nextAction &&
        updated.nextActionAt &&
        (updated.nextAction !== current.nextAction ||
          updated.nextActionAt.getTime() !== current.nextActionAt?.getTime())
      ) {
        await tx.insert(frontOfficeTasksTable).values({
          conversationId: updated.conversationId,
          leadId: updated.id,
          title: updated.nextAction,
          ownerRole: "SALES_MANAGER",
          ownerDisplayName: updated.ownerDisplayName,
          priority: "P3",
          status: "open",
          dueAt: updated.nextActionAt,
          isSynthetic: true,
        });
      }

      await audit(tx, res, {
        entityType: "lead",
        entityId: updated.id,
        action: "updated",
        beforeState: cleanAuditLead(current),
        afterState: cleanAuditLead(updated),
      });

      return updated;
    });

    if (!result) {
      res.status(404).json({ error: "Лид не найден" });
      return;
    }
    res.json(result);
  } catch (error) {
    req.log.error({ error }, "PATCH /front-office/leads/:id failed");
    handleRouteError(res, error, "Не удалось обновить лид");
  }
});

frontOfficeRouter.post(
  "/front-office/conversations/:id/notes",
  async (req, res) => {
    if (!requireInternalAlpha(res)) return;

    try {
      const input = createNoteSchema.parse(req.body);
      assertInternalMessageType(input.messageType);
      const actor = actorFromResponse(res);

      const result = await db.transaction(async (tx) => {
        const [conversation] = await tx
          .select()
          .from(frontOfficeConversationsTable)
          .where(eq(frontOfficeConversationsTable.id, req.params.id))
          .limit(1);
        if (!conversation) return null;

        assertSyntheticWriteAllowed(conversation);

        const [message] = await tx
          .insert(frontOfficeMessagesTable)
          .values({
            conversationId: conversation.id,
            messageType: input.messageType,
            direction: "internal",
            body: input.body,
            authorRole: actor.role,
            authorDisplayName: actor.name,
            factStatus: input.factStatus,
            sourceRefs: input.sourceRefs,
            isSynthetic: true,
          })
          .returning();

        await tx
          .update(frontOfficeConversationsTable)
          .set({
            lastMessageAt: message.createdAt,
            version: conversation.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(frontOfficeConversationsTable.id, conversation.id));

        await audit(tx, res, {
          entityType: "conversation",
          entityId: conversation.id,
          action:
            input.messageType === "ai_draft"
              ? "ai_draft_saved"
              : "internal_note_added",
          afterState: {
            messageId: message.id,
            messageType: message.messageType,
            factStatus: message.factStatus,
            sourceRefCount: message.sourceRefs.length,
          },
        });

        return message;
      });

      if (!result) {
        res.status(404).json({ error: "Обращение не найдено" });
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      req.log.error(
        { error },
        "POST /front-office/conversations/:id/notes failed",
      );
      handleRouteError(res, error, "Не удалось сохранить внутреннюю заметку");
    }
  },
);

frontOfficeRouter.patch("/front-office/tasks/:id", async (req, res) => {
  if (!requireInternalAlpha(res)) return;

  try {
    const input = updateTaskSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(frontOfficeTasksTable)
        .where(eq(frontOfficeTasksTable.id, req.params.id))
        .limit(1);
      if (!current) return null;

      assertSyntheticWriteAllowed(current);

      const [updated] = await tx
        .update(frontOfficeTasksTable)
        .set({
          status: input.status,
          completedAt: input.status === "done" ? new Date() : null,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(frontOfficeTasksTable.id, current.id),
            eq(frontOfficeTasksTable.version, input.version),
          ),
        )
        .returning();

      if (!updated) {
        throw new Error(
          "Запись уже изменилась другим сотрудником. Обновите данные",
        );
      }

      await audit(tx, res, {
        entityType: "task",
        entityId: updated.id,
        action: `status:${updated.status}`,
        beforeState: {
          status: current.status,
          version: current.version,
        },
        afterState: {
          status: updated.status,
          version: updated.version,
        },
      });

      return updated;
    });

    if (!result) {
      res.status(404).json({ error: "Задача не найдена" });
      return;
    }
    res.json(result);
  } catch (error) {
    req.log.error({ error }, "PATCH /front-office/tasks/:id failed");
    handleRouteError(res, error, "Не удалось обновить задачу");
  }
});

const DEMO_ROWS = [
  {
    externalKey: "demo:lead:anna",
    contactDisplayName: "Анна · демо",
    contactPointMasked: "+7 ••• •••-12-34",
    channel: "site",
    priority: "P3",
    intent: "Подобрать программу для ребёнка 6–7 лет",
    branch: "Филиал не выбран",
    stage: "NEW",
    source: "Сайт",
    childAgeBand: "6–7 лет",
    programInterest: "Творческая программа",
    owner: "Мария · демо",
    nextAction: "Уточнить район и удобное время",
    dueOffsetHours: -2,
    message: "Ищу занятия после школы, хотелось бы понять варианты.",
  },
  {
    externalKey: "demo:lead:olga",
    contactDisplayName: "Ольга · демо",
    contactPointMasked: "+7 ••• •••-45-67",
    channel: "phone",
    priority: "P3",
    intent: "Запрос пробного занятия",
    branch: "Лиственная · демо",
    stage: "QUALIFIED",
    source: "Рекомендация",
    childAgeBand: "4–5 лет",
    programInterest: "Подготовка к школе",
    owner: "Мария · демо",
    nextAction: "Подтвердить подходящую программу",
    dueOffsetHours: 4,
    message: "Нужна программа два раза в неделю ближе к вечеру.",
  },
  {
    externalKey: "demo:lead:sergey",
    contactDisplayName: "Сергей · демо",
    contactPointMasked: "+7 ••• •••-78-90",
    channel: "messenger",
    priority: "P3",
    intent: "Подбор программы",
    branch: "Атлас · демо",
    stage: "PROGRAM_MATCHED",
    source: "Карты",
    childAgeBand: "8–9 лет",
    programInterest: "Изобразительное искусство",
    owner: "Анна · демо",
    nextAction: "Согласовать запрос на пробное",
    dueOffsetHours: 20,
    message: "Подскажите, можно ли сначала прийти познакомиться с форматом?",
  },
  {
    externalKey: "demo:lead:elena",
    contactDisplayName: "Елена · демо",
    contactPointMasked: "+7 ••• •••-11-22",
    channel: "email",
    priority: "P3",
    intent: "Пробное занятие",
    branch: "Атлас · демо",
    stage: "TRIAL_REQUESTED",
    source: "Сайт",
    childAgeBand: "5–6 лет",
    programInterest: "Подготовка к школе",
    owner: "Анна · демо",
    nextAction: "Получить подтверждение администратора",
    dueOffsetHours: 28,
    message: "Мы выбрали вечер вторника, ждём подтверждение.",
  },
  {
    externalKey: "demo:lead:dmitry",
    contactDisplayName: "Дмитрий · демо",
    contactPointMasked: "+7 ••• •••-33-44",
    channel: "site",
    priority: "P3",
    intent: "Запись после пробного",
    branch: "Лиственная · демо",
    stage: "TRIAL_CONFIRMED",
    source: "Рекомендация",
    childAgeBand: "7–8 лет",
    programInterest: "Творческая мастерская",
    owner: "Мария · демо",
    nextAction: "Зафиксировать результат пробного",
    dueOffsetHours: 50,
    message: "Пробное подтвердили, хотим понять дальнейшие шаги.",
  },
  {
    externalKey: "demo:lead:irina",
    contactDisplayName: "Ирина · демо",
    contactPointMasked: "+7 ••• •••-55-66",
    channel: "internal",
    priority: "P4",
    intent: "Повторная заявка",
    branch: "Атлас · демо",
    stage: "WON",
    source: "Сайт",
    childAgeBand: "6–7 лет",
    programInterest: "Подготовка к школе",
    owner: "Мария · демо",
    nextAction: null,
    dueOffsetHours: null,
    message: "Демо-сценарий завершён договором.",
  },
] as const;

frontOfficeRouter.post("/front-office/demo/seed", async (req, res) => {
  if (!requireInternalAlpha(res)) return;

  try {
    let created = 0;
    let existing = 0;

    await db.transaction(async (tx) => {
      for (const row of DEMO_ROWS) {
        const [found] = await tx
          .select()
          .from(frontOfficeConversationsTable)
          .where(
            and(
              eq(
                frontOfficeConversationsTable.projectId,
                FRONT_OFFICE_PROJECT_ID,
              ),
              eq(frontOfficeConversationsTable.externalKey, row.externalKey),
            ),
          )
          .limit(1);
        if (found) {
          existing += 1;
          continue;
        }

        const nextActionAt =
          row.dueOffsetHours === null
            ? null
            : new Date(Date.now() + row.dueOffsetHours * 60 * 60 * 1_000);
        const [conversation] = await tx
          .insert(frontOfficeConversationsTable)
          .values({
            projectId: FRONT_OFFICE_PROJECT_ID,
            externalKey: row.externalKey,
            kind: "lead",
            channel: row.channel,
            status: row.stage === "WON" ? "resolved" : "open",
            priority: row.priority,
            contactDisplayName: row.contactDisplayName,
            contactPointMasked: row.contactPointMasked,
            identityStatus: "not_required",
            intent: row.intent,
            branchOrObject: row.branch,
            ownerRole: "SALES_MANAGER",
            ownerDisplayName: row.owner,
            nextActionAt,
            isSynthetic: true,
          })
          .returning();

        const [lead] = await tx
          .insert(frontOfficeLeadsTable)
          .values({
            conversationId: conversation.id,
            stage: row.stage,
            source: row.source,
            childAgeBand: row.childAgeBand,
            branchPreference: row.branch,
            programInterest: row.programInterest,
            ownerDisplayName: row.owner,
            nextAction: row.nextAction,
            nextActionAt,
            trialStatus:
              row.stage === "TRIAL_REQUESTED"
                ? "requested"
                : row.stage === "TRIAL_CONFIRMED" || row.stage === "WON"
                  ? "confirmed"
                  : "not_requested",
            wonAt: row.stage === "WON" ? new Date() : null,
            isSynthetic: true,
          })
          .returning();

        await tx.insert(frontOfficeMessagesTable).values({
          conversationId: conversation.id,
          messageType: "incoming",
          direction: "incoming",
          body: row.message,
          authorRole: "synthetic_customer",
          authorDisplayName: row.contactDisplayName,
          factStatus: "UNVERIFIED",
          isSynthetic: true,
        });

        if (row.nextAction && nextActionAt) {
          await tx.insert(frontOfficeTasksTable).values({
            conversationId: conversation.id,
            leadId: lead.id,
            title: row.nextAction,
            ownerRole: "SALES_MANAGER",
            ownerDisplayName: row.owner,
            priority: row.priority,
            status: "open",
            dueAt: nextActionAt,
            isSynthetic: true,
          });
        }

        await audit(tx, res, {
          entityType: "lead",
          entityId: lead.id,
          action: "demo_seeded",
          afterState: cleanAuditLead(lead),
        });
        created += 1;
      }
    });

    res.json({
      ok: true,
      projectId: FRONT_OFFICE_PROJECT_ID,
      mode: FRONT_OFFICE_MODE,
      runId: randomUUID(),
      created,
      existing,
    });
  } catch (error) {
    req.log.error({ error }, "POST /front-office/demo/seed failed");
    handleRouteError(res, error, "Не удалось создать демонстрационные данные");
  }
});
