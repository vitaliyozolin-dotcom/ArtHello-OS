import { and, asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  educationAttendance, educationCommunications, educationFeedback, educationGroups,
  educationLessons, educationPrograms, educationProgress, educationStudents, entities, organizationBranches, userBranchAccess,
} from "../../../db/schema";
import { attendanceSummary, educationScope, filterEducationScope, progressBand } from "../../../lib/education";
import { canAccessApi } from "../../../lib/access-policy";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const sectionAllowed = canAccessApi(context.auth.user, "/api/education", "GET");
  if (!sectionAllowed) return Response.json({ error: "Нет доступа к образовательному контуру" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    // Access settings define administration as all ACTIVE branches. Only the
    // canonical owner retains unrestricted access to orphaned/archived records.
    const unrestrictedOwner = context.apiRole === "OWNER" && context.auth.user.isSystemOwner;
    const branchGrants = unrestrictedOwner ? [] : context.auth.user.isAdministrative
      ? await db.select({ branchId: organizationBranches.id })
        .from(organizationBranches).where(eq(organizationBranches.status, "Активен"))
      : await db.select({ branchId: userBranchAccess.branchId })
        .from(userBranchAccess)
        .innerJoin(organizationBranches, eq(organizationBranches.id, userBranchAccess.branchId))
        .where(and(eq(userBranchAccess.userId, context.appUserId), eq(organizationBranches.status, "Активен")));
    const scope = educationScope(context.apiRole, context.appUserId, {
      sectionAllowed,
      unrestrictedOwner,
      branchIds: branchGrants.map((row) => row.branchId),
    });
    const [programs, allGroups, allStudents, allLessons, allAttendance, allProgress, allFeedback, allCommunications, entityRows, allTasks] = await Promise.all([
      db.select().from(educationPrograms).orderBy(asc(educationPrograms.title)),
      db.select().from(educationGroups),
      db.select().from(educationStudents),
      db.select().from(educationLessons).orderBy(asc(educationLessons.scheduledAt)),
      db.select().from(educationAttendance),
      db.select().from(educationProgress),
      db.select().from(educationFeedback),
      db.select().from(educationCommunications).orderBy(asc(educationCommunications.createdAt)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      selectVisibleTasks(db, context),
    ]);
    const { groups, students } = filterEducationScope(scope, allGroups, allStudents);
    const groupIds = new Set(groups.map((row) => row.id));
    const studentIds = new Set(students.map((row) => row.id));
    const lessons = allLessons.filter((row) => groupIds.has(row.groupId));
    const lessonIds = new Set(lessons.map((row) => row.id));
    const attendance = allAttendance.filter((row) => lessonIds.has(row.lessonId) && studentIds.has(row.studentId));
    const progress = allProgress.filter((row) => studentIds.has(row.studentId)).map((row) => ({ ...row, band: progressBand(row.score) }));
    const feedback = redactHiddenTaskReferences(allFeedback.filter((row) => studentIds.has(row.studentId)), allTasks);
    const communications = allCommunications.filter((row) => {
      if (row.audienceType === "Группа") return groupIds.has(row.audienceId);
      if (row.audienceType !== "Семья") return false;
      if (scope.kind === "all") return true;
      // A family-level thread has no branch ID and can discuss children at
      // several branches. Branch access alone cannot authorize the whole thread.
      return scope.kind === "family" && row.audienceId === scope.id;
    });
    const scopedPrograms = programs.filter((row) => groups.some((group) => group.programId === row.id));
    // Programs are the existing shared curriculum catalogue for DIRECTOR and
    // METHODIST. Their `scope` is age/subject text, not a branch ACL. Preserve
    // unassigned programmes so these roles can select one for a first group.
    const canReadProgramCatalogue = unrestrictedOwner || ["DIRECTOR", "METHODIST"].includes(context.apiRole);
    const visiblePrograms = canReadProgramCatalogue ? programs : scopedPrograms;
    const visibleEntityIds = new Set([
      ...groups.flatMap((row) => [row.teacherEntityId, row.unitEntityId]),
      ...students.flatMap((row) => [row.childEntityId, row.familyEntityId]),
      ...lessons.flatMap((row) => [row.teacherEntityId, row.substituteEntityId]),
      // Shared catalogue access must not expand the personal name directory.
      ...(unrestrictedOwner ? visiblePrograms : scopedPrograms).flatMap((row) => [row.authorEntityId, row.methodistEntityId]),
    ]);
    const entityNames = Object.fromEntries(entityRows.filter((row) => visibleEntityIds.has(row.id)).map((row) => [row.id, row.displayName]));
    const today = new Date().toISOString().slice(0, 10);
    return Response.json({
      scope, programs: visiblePrograms, groups, students, lessons, attendance, progress, feedback, communications, entityNames,
      summary: {
        groups: groups.length,
        students: students.length,
        lessonsToday: lessons.filter((row) => row.scheduledAt.startsWith(today)).length,
        attendance: attendanceSummary(attendance),
        openFeedback: feedback.filter((row) => row.status !== "Закрыто").length,
      },
      chain: {
        programId: visiblePrograms[0]?.id ?? "",
        teacherId: groups[0]?.teacherEntityId ?? "",
        groupId: groups[0]?.id ?? "",
        lessonId: lessons[0]?.id ?? "",
        attendanceId: attendance[0]?.id ?? "",
        progressId: progress[0]?.id ?? "",
        feedbackId: feedback[0]?.id ?? "",
      },
      privacy: "Медицинские сведения отсутствуют в ответе. Персональный учебный доступ появится после связи учётной записи с карточкой сотрудника или семьи.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База обучения ещё не подключена" : "Не удалось загрузить обучение" }, { status: 503 });
  }
}
