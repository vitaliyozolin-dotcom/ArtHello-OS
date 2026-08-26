import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, educationAttendance, educationCommunications, educationFeedback, educationGroups, educationLessons, educationPrograms, educationStudents, entities, tasks } from "../../../db/schema";
import { nextProgramVersion } from "../../../lib/education";
import { getRequestUser } from "../../../lib/request-user";

const leaders = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE"]);
const educationRoles = new Set([...leaders, "TEACHER", "PARENT", "METHODIST"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!educationRoles.has(role)) return Response.json({ error: "Нет прав на образовательное действие" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "recordAttendance") return recordAttendance(actor, role, body);
    if (action === "createProgram") return createProgram(actor, role, body);
    if (action === "createProgramVersion") return createProgramVersion(actor, role, body);
    if (action === "createFeedbackTask") return createFeedbackTask(actor, role, body);
    if (action === "sendMessage") return sendMessage(actor, role, body);
    if (action === "createGroup") return createGroup(actor, role, body);
    if (action === "createLesson") return createLesson(actor, role, body);
    if (action === "enrollStudent") return enrollStudent(actor, role, body);
    if (action === "importEducationRows") return importEducationRows(actor, role, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function createProgram(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "METHODIST")) return Response.json({ error: "Программу создаёт методист или руководитель" }, { status: 403 });
  const title = clean(body.title, 160);
  const scope = clean(body.scope, 160);
  const expectedResult = clean(body.expectedResult, 500);
  const materialRef = clean(body.materialRef, 240);
  const methodistEntityId = clean(body.methodistEntityId, 80) || actor;
  if (title.length < 3 || scope.length < 3 || expectedResult.length < 5) return Response.json({ error: "Укажите название, область программы и ожидаемый результат" }, { status: 400 });
  const id = `PRG-M-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const db = getDb();
  const [program] = await db.insert(educationPrograms).values({
    id,
    title,
    version: 1,
    status: "На проверке",
    authorEntityId: actor,
    methodistEntityId,
    scope,
    materialRef,
    expectedResult,
    sourceType: "MANUAL",
  }).returning();
  await db.insert(auditEvents).values({ actor, action: "education.program_created", entityType: "education_program", entityId: id, payload: JSON.stringify({ title, scope, methodistEntityId, reviewRequired: true }) });
  return Response.json({ program, reviewRequired: true }, { status: 201 });
}

async function recordAttendance(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "TEACHER")) return Response.json({ error: "Посещаемость фиксирует назначенный педагог или руководитель" }, { status: 403 });
  const id = clean(body.id, 80), attendanceStatus = clean(body.attendanceStatus, 30), result = clean(body.result, 300);
  if (!["Присутствовал", "Отсутствовал", "Опоздал"].includes(attendanceStatus) || result.length < 5) return Response.json({ error: "Укажите статус и наблюдаемый результат" }, { status: 400 });
  const db = getDb();
  const [row] = await db.select().from(educationAttendance).where(eq(educationAttendance.id, id)).limit(1);
  if (!row) return Response.json({ error: "Запись посещаемости не найдена" }, { status: 404 });
  if (role === "TEACHER") {
    return Response.json({ error: "Учётная запись педагога ещё не связана с карточкой сотрудника" }, { status: 403 });
  }
  const [updated] = await db.update(educationAttendance).set({ attendanceStatus, result, recordedBy: actor, updatedAt: new Date().toISOString() }).where(eq(educationAttendance.id, id)).returning();
  await db.insert(auditEvents).values({ actor, action: "education.attendance_recorded", entityType: "education_attendance", entityId: id, payload: JSON.stringify({ attendanceStatus }) });
  return Response.json({ attendance: updated });
}

async function createProgramVersion(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "METHODIST")) return Response.json({ error: "Версию программы создаёт методист или руководитель" }, { status: 403 });
  const id = clean(body.programId, 80), note = clean(body.note, 500);
  if (note.length < 10) return Response.json({ error: "Опишите основание новой версии" }, { status: 400 });
  const db = getDb(); const [program] = await db.select().from(educationPrograms).where(eq(educationPrograms.id, id)).limit(1);
  if (!program) return Response.json({ error: "Программа не найдена" }, { status: 404 });
  const version = nextProgramVersion(program.version);
  await db.update(educationPrograms).set({ version, status: "На проверке", updatedAt: new Date().toISOString() }).where(eq(educationPrograms.id, id));
  await db.insert(auditEvents).values({ actor, action: "education.program_version_created", entityType: "education_program", entityId: id, payload: JSON.stringify({ from: program.version, to: version, note }) });
  return Response.json({ program: { ...program, version, status: "На проверке" } });
}

async function createFeedbackTask(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "METHODIST" || role === "TEACHER")) return Response.json({ error: "Нет прав создать методическую задачу" }, { status: 403 });
  const id = clean(body.feedbackId, 80), db = getDb(); const [feedback] = await db.select().from(educationFeedback).where(eq(educationFeedback.id, id)).limit(1);
  if (!feedback) return Response.json({ error: "Отзыв не найден" }, { status: 404 });
  const key = `EDU_FEEDBACK:${id}`; const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, key)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const due = new Date(); due.setUTCDate(due.getUTCDate() + 7);
  const [task] = await db.insert(tasks).values({ title: feedback.recommendation, owner: actor, dueDate: due.toISOString().slice(0, 10), priority: "Средний", status: "Входящие", sourceType: "Отзыв родителя", sourceId: id, description: `${feedback.comment}. Проверить на данных следующего занятия и оформить решение.`, assigneeEntityId: "", kind: "Автозадача", automationKey: key, createdBy: actor }).returning();
  await db.update(educationFeedback).set({ status: "В работе", relatedTaskId: task.id }).where(eq(educationFeedback.id, id));
  return Response.json({ task }, { status: 201 });
}

async function sendMessage(actor: string, role: string, body: Record<string, unknown>) {
  const audienceType = clean(body.audienceType, 20), audienceId = clean(body.audienceId, 80), message = clean(body.message, 600);
  if (!["Группа", "Семья"].includes(audienceType) || !audienceId || message.length < 3) return Response.json({ error: "Укажите адресата и сообщение" }, { status: 400 });
  if (role === "PARENT") return Response.json({ error: "Учётная запись родителя ещё не связана с карточкой семьи" }, { status: 403 });
  const id = `COM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [communication] = await getDb().insert(educationCommunications).values({ id, communicationType: "Чат", audienceType, audienceId, title: "Сообщение", body: message, createdBy: actor }).returning();
  return Response.json({ communication }, { status: 201 });
}

async function createGroup(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "METHODIST")) return Response.json({ error: "Класс или группу создаёт руководитель или методист" }, { status: 403 });
  const name = clean(body.name, 120), branchId = clean(body.branchId, 80), programId = clean(body.programId, 80), teacherId = clean(body.teacherId, 80), room = clean(body.room, 80);
  if (!name || !branchId || !programId || !teacherId) return Response.json({ error: "Укажите название, филиал, программу и педагога" }, { status: 400 });
  const db = getDb();
  const [program] = await db.select().from(educationPrograms).where(eq(educationPrograms.id, programId)).limit(1);
  if (!program) return Response.json({ error: "Учебная программа не найдена" }, { status: 404 });
  const id = `GRP-M-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [group] = await db.insert(educationGroups).values({ id, name, unitEntityId: branchId, programId, teacherEntityId: teacherId, room, status: "На проверке" }).returning();
  await db.insert(auditEvents).values({ actor, action: "education.group_created", entityType: "education_group", entityId: id, payload: JSON.stringify({ branchId, programId, teacherId }) });
  return Response.json({ group, reviewRequired: true }, { status: 201 });
}

async function createLesson(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "METHODIST" || role === "TEACHER")) return Response.json({ error: "Занятие создаёт назначенный педагог, методист или руководитель" }, { status: 403 });
  const groupId = clean(body.groupId, 80), scheduledAt = clean(body.scheduledAt, 40), topic = clean(body.topic, 180), teacherId = clean(body.teacherId, 80), room = clean(body.room, 80), homework = clean(body.homework, 500);
  if (!groupId || !scheduledAt || !topic || !teacherId) return Response.json({ error: "Укажите группу, дату, тему и педагога" }, { status: 400 });
  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) return Response.json({ error: "Проверьте дату и время занятия" }, { status: 400 });
  const db = getDb(); const [group] = await db.select().from(educationGroups).where(eq(educationGroups.id, groupId)).limit(1);
  if (!group) return Response.json({ error: "Класс или группа не найдены" }, { status: 404 });
  if (role === "TEACHER") return Response.json({ error: "Учётная запись педагога ещё не связана с карточкой сотрудника" }, { status: 403 });
  const id = `LES-M-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [lesson] = await db.insert(educationLessons).values({ id, groupId, programId: group.programId, scheduledAt: scheduledDate.toISOString(), topic, teacherEntityId: teacherId, room: room || group.room, status: "Черновик", homework }).returning();
  await db.insert(auditEvents).values({ actor, action: "education.lesson_created", entityType: "education_lesson", entityId: id, payload: JSON.stringify({ groupId, scheduledAt, status: "Черновик" }) });
  return Response.json({ lesson }, { status: 201 });
}

async function enrollStudent(actor: string, role: string, body: Record<string, unknown>) {
  if (!leaders.has(role)) return Response.json({ error: "Ученика в группу добавляет руководитель после проверки карточки семьи" }, { status: 403 });
  const childId = clean(body.childId, 80), familyId = clean(body.familyId, 80), groupId = clean(body.groupId, 80);
  if (!childId || !familyId || !groupId) return Response.json({ error: "Укажите ID ребёнка, семьи и группы" }, { status: 400 });
  const db = getDb();
  const [group] = await db.select().from(educationGroups).where(eq(educationGroups.id, groupId)).limit(1);
  const [child] = await db.select().from(entities).where(eq(entities.id, childId)).limit(1);
  const [family] = await db.select().from(entities).where(eq(entities.id, familyId)).limit(1);
  if (!group || child?.entityType !== "Ребёнок" || family?.entityType !== "Семья") return Response.json({ error: "Проверьте существующие карточки ребёнка, семьи и группы" }, { status: 404 });
  const id = `STU-M-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [student] = await db.insert(educationStudents).values({ id, childEntityId: childId, familyEntityId: familyId, groupId, cabinetStatus: "Доступ не выдан", status: "На проверке" }).returning();
  await db.insert(auditEvents).values({ actor, action: "education.student_enrolled", entityType: "education_student", entityId: id, payload: JSON.stringify({ childId, familyId, groupId }) });
  return Response.json({ student, reviewRequired: true }, { status: 201 });
}

async function importEducationRows(actor: string, role: string, body: Record<string, unknown>) {
  if (!leaders.has(role)) return Response.json({ error: "Контролируемый импорт запускает только руководитель" }, { status: 403 });
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) as Array<Record<string, unknown>> : [];
  if (!rows.length) return Response.json({ error: "Файл не содержит строк для импорта" }, { status: 400 });
  const normalized = rows.map((row, index) => ({
    index: index + 2,
    type: clean(row.type, 30).toLocaleLowerCase("ru"), name: clean(row.name, 120), branchId: clean(row.branchId, 80), programId: clean(row.programId, 80), teacherId: clean(row.teacherId, 80), room: clean(row.room, 80),
    childId: clean(row.childId, 80), familyId: clean(row.familyId, 80), groupId: clean(row.groupId, 80), scheduledAt: clean(row.scheduledAt, 40), topic: clean(row.topic, 180), homework: clean(row.homework, 500),
  }));
  const invalid = normalized.filter((row) => {
    if (["группа", "group"].includes(row.type)) return !row.name || !row.branchId || !row.programId || !row.teacherId;
    if (["ученик", "student"].includes(row.type)) return !row.childId || !row.familyId || !row.groupId;
    if (["занятие", "lesson"].includes(row.type)) return !row.groupId || !row.scheduledAt || !row.topic || !row.teacherId || Number.isNaN(new Date(row.scheduledAt).getTime());
    return true;
  });
  if (invalid.length) return Response.json({ error: `Импорт остановлен: проверьте строки ${invalid.slice(0, 8).map((row) => row.index).join(", ")}` }, { status: 400 });
  const db = getDb();
  const [existingGroups, existingPrograms, existingEntities] = await Promise.all([
    db.select().from(educationGroups),
    db.select().from(educationPrograms),
    db.select().from(entities),
  ]);
  const groupsById = new Map(existingGroups.map((group) => [group.id, group]));
  const programIds = new Set(existingPrograms.map((program) => program.id));
  const entitiesById = new Map(existingEntities.map((entity) => [entity.id, entity]));
  const brokenLinks = normalized.filter((row) => {
    if (["группа", "group"].includes(row.type)) return !programIds.has(row.programId);
    if (["ученик", "student"].includes(row.type)) return !groupsById.has(row.groupId) || entitiesById.get(row.childId)?.entityType !== "Ребёнок" || entitiesById.get(row.familyId)?.entityType !== "Семья";
    return !groupsById.has(row.groupId);
  });
  if (brokenLinks.length) return Response.json({ error: `Импорт остановлен: в строках ${brokenLinks.slice(0, 8).map((row) => row.index).join(", ")} не найдены связанные программа, группа, ребёнок или семья` }, { status: 400 });
  let imported = 0;
  for (const row of normalized) {
    if (["группа", "group"].includes(row.type)) {
      await db.insert(educationGroups).values({ id: `GRP-I-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, name: row.name, unitEntityId: row.branchId, programId: row.programId, teacherEntityId: row.teacherId, room: row.room, status: "На проверке" });
    } else if (["ученик", "student"].includes(row.type)) {
      await db.insert(educationStudents).values({ id: `STU-I-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, childEntityId: row.childId, familyEntityId: row.familyId, groupId: row.groupId, cabinetStatus: "Доступ не выдан", status: "На проверке" });
    } else {
      const group = groupsById.get(row.groupId)!;
      await db.insert(educationLessons).values({ id: `LES-I-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, groupId: row.groupId, programId: group.programId, scheduledAt: new Date(row.scheduledAt).toISOString(), topic: row.topic, teacherEntityId: row.teacherId, room: row.room || group.room, status: "На проверке", homework: row.homework });
    }
    imported += 1;
  }
  await db.insert(auditEvents).values({ actor, action: "education.csv_imported", entityType: "education_import", entityId: `EDU-IMPORT-${Date.now()}`, payload: JSON.stringify({ imported, reviewRequired: true }) });
  return Response.json({ imported, reviewRequired: true }, { status: 201 });
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
