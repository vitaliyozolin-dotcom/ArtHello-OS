import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, educationAttendance, educationCommunications, educationFeedback, educationGroups, educationLessons, educationPrograms, tasks } from "../../../db/schema";
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
    if (action === "createProgramVersion") return createProgramVersion(actor, role, body);
    if (action === "createFeedbackTask") return createFeedbackTask(actor, role, body);
    if (action === "sendMessage") return sendMessage(actor, role, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Действие не выполнено" }, { status: 500 });
  }
}

async function recordAttendance(actor: string, role: string, body: Record<string, unknown>) {
  if (!(leaders.has(role) || role === "TEACHER")) return Response.json({ error: "Посещаемость фиксирует назначенный педагог или руководитель" }, { status: 403 });
  const id = clean(body.id, 80), attendanceStatus = clean(body.attendanceStatus, 30), result = clean(body.result, 300);
  if (!["Присутствовал", "Отсутствовал", "Опоздал"].includes(attendanceStatus) || result.length < 5) return Response.json({ error: "Укажите статус и наблюдаемый результат" }, { status: 400 });
  const db = getDb();
  const [row] = await db.select().from(educationAttendance).where(eq(educationAttendance.id, id)).limit(1);
  if (!row) return Response.json({ error: "Запись посещаемости не найдена" }, { status: 404 });
  if (role === "TEACHER") {
    const [lesson] = await db.select().from(educationLessons).where(eq(educationLessons.id, row.lessonId)).limit(1);
    if (!lesson) return Response.json({ error: "Занятие не найдено" }, { status: 404 });
    const [group] = await db.select().from(educationGroups).where(eq(educationGroups.id, lesson.groupId)).limit(1);
    if (!group || group.teacherEntityId !== "EMP-T-032") return Response.json({ error: "Педагог не назначен на эту группу" }, { status: 403 });
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
  const [task] = await db.insert(tasks).values({ title: feedback.recommendation, owner: "Методист T-M01", dueDate: "2026-08-31", priority: "Средний", status: "Входящие", sourceType: "Отзыв родителя", sourceId: id, description: `${feedback.comment}. Проверить на данных следующего занятия и оформить решение.`, assigneeEntityId: "EMP-T-METHOD-001", kind: "Автозадача", automationKey: key, createdBy: actor }).returning();
  await db.update(educationFeedback).set({ status: "В работе", relatedTaskId: task.id }).where(eq(educationFeedback.id, id));
  return Response.json({ task }, { status: 201 });
}

async function sendMessage(actor: string, role: string, body: Record<string, unknown>) {
  const audienceType = clean(body.audienceType, 20), audienceId = clean(body.audienceId, 80), message = clean(body.message, 600);
  if (!["Группа", "Семья"].includes(audienceType) || !audienceId || message.length < 3) return Response.json({ error: "Укажите адресата и сообщение" }, { status: 400 });
  if (role === "PARENT" && (audienceType !== "Семья" || audienceId !== "FAM-T-014")) return Response.json({ error: "Родитель видит только чат своей семьи" }, { status: 403 });
  const id = `COM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const [communication] = await getDb().insert(educationCommunications).values({ id, communicationType: "Чат", audienceType, audienceId, title: "Сообщение", body: message, createdBy: actor }).returning();
  return Response.json({ communication }, { status: 201 });
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
