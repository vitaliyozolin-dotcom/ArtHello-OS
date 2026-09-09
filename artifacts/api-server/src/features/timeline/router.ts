import { Router } from "express";
import { db } from "@workspace/db";
import {
  familiesTable,
  studentProfilesTable,
  timelineEventsTable,
  familyHealthTable,
  healthAlertsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const timelineRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

// ─── POST /api/identity/build-timeline ────────────────────────────────────────
// Populates timeline_events from all CRM data sources.
// Strategy: DELETE all existing events and rebuild from scratch on each run.
// Dual-linkage for payments:
//   1. Primary: crm_payments.student_crm_id → student_profiles → families
//   2. Secondary: crm_payments.student_crm_id → crm_students.phone → families.primary_phone

timelineRouter.post(
  "/identity/build-timeline",
  async (_req, res): Promise<void> => {
    await db.execute(sql`DELETE FROM timeline_events`);

    let paymentsAdded = 0;
    let subscriptionsAdded = 0;
    let attendanceAdded = 0;
    let leadsAdded = 0;

    const dbg = {
      payments: {
        total_in_crm: 0,
        linked_primary: 0,
        linked_via_phone: 0,
        no_customer_id: 0,
        orphan_not_synced: 0,
        skipped_no_date: 0,
      },
      attendance: {
        total_in_crm: 0,
        linked_to_family: 0,
        note: null as string | null,
      },
    };

    // ── 1. Payments — dual-linkage query ─────────────────────────────────────────
    // Primary link:  student_profiles → families  (built by buildFamilies)
    // Secondary link: crm_students.phone → families.primary_phone  (fallback for
    //                 students present in CRM but not yet in student_profiles)
    const payments = await db.execute(sql`
    SELECT
      p.crm_id,
      p.student_crm_id,
      COALESCE(p.amount::text, NULLIF(p.raw->>'income', ''), '0')             AS payment_amount,
      COALESCE(
        p.payment_date::timestamp,
        (p.raw->>'created_at')::timestamp,
        p.synced_at
      )                                                                         AS event_time,
      COALESCE(p.comment, NULLIF(p.raw->>'note', ''))                         AS payment_comment,
      -- Primary resolution (via student_profiles built by buildFamilies)
      sp.family_id                                                              AS family_id_primary,
      sp.student_person_id                                                      AS student_person_id_primary,
      sp.full_name                                                              AS student_name_primary,
      f_primary.primary_guardian_person_id                                     AS guardian_id_primary,
      -- Secondary resolution (crm_students phone → families.primary_phone)
      f_phone.id                                                                AS family_id_phone,
      sp_phone.student_person_id                                               AS student_person_id_phone,
      s_phone.full_name                                                         AS student_name_phone,
      f_phone.primary_guardian_person_id                                       AS guardian_id_phone
    FROM crm_payments p
    -- Primary path
    LEFT JOIN student_profiles sp            ON sp.student_crm_id = p.student_crm_id
    LEFT JOIN families f_primary             ON f_primary.id = sp.family_id
    -- Secondary path (only when primary fails)
    LEFT JOIN crm_students s_phone           ON s_phone.crm_id = p.student_crm_id
                                                AND sp.family_id IS NULL
    LEFT JOIN families f_phone               ON f_phone.primary_phone = s_phone.phone
                                                AND sp.family_id IS NULL
    LEFT JOIN student_profiles sp_phone      ON sp_phone.student_crm_id = p.student_crm_id
                                                AND sp.family_id IS NULL
  `);

    dbg.payments.total_in_crm = payments.rows.length;

    for (const row of payments.rows) {
      const crmId = row["crm_id"] as string;
      const studentCrmId = row["student_crm_id"] as string | null;
      const amount = row["payment_amount"] as string | null;
      const eventTime = row["event_time"] as string | null;
      const comment = row["payment_comment"] as string | null;

      // Pick best linkage
      const familyId = (row["family_id_primary"] ?? row["family_id_phone"]) as
        string | null;
      const guardianPersonId = (row["guardian_id_primary"] ??
        row["guardian_id_phone"]) as string | null;
      const studentPersonId = (row["student_person_id_primary"] ??
        row["student_person_id_phone"]) as string | null;
      const studentName = (row["student_name_primary"] ??
        row["student_name_phone"]) as string | null;
      const linkedViaPhone =
        !row["family_id_primary"] && !!row["family_id_phone"];

      // Debug accounting
      if (!studentCrmId) {
        dbg.payments.no_customer_id++;
      } else if (!familyId) {
        // Has student_crm_id but no family resolved either way
        dbg.payments.orphan_not_synced++;
      } else if (linkedViaPhone) {
        dbg.payments.linked_via_phone++;
      } else {
        dbg.payments.linked_primary++;
      }

      if (!eventTime) {
        dbg.payments.skipped_no_date++;
        continue;
      }

      const amtNum = amount ? parseFloat(amount) : 0;
      const isAdjustment = amtNum < 0;
      const isNoAmount = amtNum === 0;

      await db
        .insert(timelineEventsTable)
        .values({
          familyId: familyId ?? undefined,
          personId: guardianPersonId ?? undefined,
          studentPersonId: studentPersonId ?? undefined,
          eventType: isAdjustment
            ? "payment_adjustment"
            : isNoAmount
              ? "payment_overdue"
              : "payment_received",
          eventTime: new Date(eventTime),
          title: isAdjustment
            ? `Корректировка ${amtNum.toLocaleString("ru-RU")} ₽${studentName ? ` — ${studentName}` : ""}`
            : isNoAmount
              ? `Платёж без суммы${studentName ? ` — ${studentName}` : ""}`
              : `Оплата ${amtNum.toLocaleString("ru-RU")} ₽${studentName ? ` — ${studentName}` : ""}`,
          description: comment ?? undefined,
          amount: amount ?? undefined,
          sourceSystem: "alphaCRM",
          relatedEntityType: "payment",
          relatedEntityId: crmId,
          severity: isAdjustment ? "warning" : isNoAmount ? "warning" : "info",
          raw: {
            student_crm_id: studentCrmId,
            student_name: studentName,
            amount,
            link_method: linkedViaPhone
              ? "phone"
              : familyId
                ? "profile"
                : "unlinked",
          },
        })
        .onConflictDoNothing();
      paymentsAdded++;
    }

    // ── 2. Students → student_registered events ──────────────────────────────────
    // Enriched with dob, balance, lesson balance, study status, next lesson.
    const students = await db.execute(sql`
    SELECT
      s.crm_id,
      s.full_name,
      s.status,
      COALESCE(
        s.created_at_crm,
        (s.raw->>'created_at')::timestamp,
        s.synced_at
      )                                           AS event_time,
      s.raw->>'dob'                               AS dob,
      s.raw->>'balance'                           AS balance,
      s.raw->>'balance_base'                      AS balance_base,
      s.raw->>'paid_lesson_count'                 AS paid_lesson_count,
      s.raw->>'paid_till'                         AS paid_till,
      s.raw->>'study_status_id'                   AS study_status_id,
      s.raw->>'last_attend_date'                  AS last_attend_date,
      s.raw->>'next_lesson_date'                  AS next_lesson_date,
      s.raw->>'is_study'                          AS is_study,
      sp.family_id,
      sp.student_person_id,
      f.primary_guardian_person_id               AS guardian_person_id
    FROM crm_students s
    LEFT JOIN student_profiles sp ON sp.student_crm_id = s.crm_id
    LEFT JOIN families f ON f.id = sp.family_id
  `);

    // study_status_id → human label
    const studyStatusLabel: Record<string, string> = {
      "1": "Учится",
      "2": "Пробное занятие",
      "3": "Отложен",
      "4": "Завершён",
      "5": "Заморожен",
      "6": "Архив",
      "7": "Новый",
    };

    for (const row of students.rows) {
      const crmId = row["crm_id"] as string;
      const fullName = row["full_name"] as string | null;
      const eventTime = row["event_time"] as string | null;
      const familyId = row["family_id"] as string | null;
      const guardianPersonId = row["guardian_person_id"] as string | null;
      const studentPersonId = row["student_person_id"] as string | null;
      const dob = row["dob"] as string | null;
      const balance = row["balance"] as string | null;
      const balanceBase = row["balance_base"] as string | null;
      const paidLessons = row["paid_lesson_count"] as string | null;
      const paidTill = row["paid_till"] as string | null;
      const studyStatusId = row["study_status_id"] as string | null;
      const lastAttend = row["last_attend_date"] as string | null;
      const nextLesson = row["next_lesson_date"] as string | null;
      const isStudy = row["is_study"] as string | null;

      if (!eventTime) continue;

      // Compute age from dob (format: DD.MM.YYYY or ISO)
      let ageStr = "";
      if (dob && dob !== "") {
        const parts = dob.includes(".") ? dob.split(".").reverse() : null;
        const dobDate = parts
          ? new Date(`${parts[0]}-${parts[1]}-${parts[2]}`)
          : new Date(dob);
        if (!isNaN(dobDate.getTime())) {
          const ageYears = Math.floor(
            (Date.now() - dobDate.getTime()) / (365.25 * 86_400_000),
          );
          if (ageYears > 0 && ageYears < 30) ageStr = `, ${ageYears} лет`;
        }
      }

      const statusLabel =
        studyStatusLabel[studyStatusId ?? ""] ??
        (isStudy === "1" ? "активный" : "неактивный");
      const balanceNum = parseFloat(balance ?? "0");
      const balanceBaseNum = parseFloat(balanceBase ?? "0");
      const paidLessonsNum = parseInt(paidLessons ?? "0", 10);

      const descParts: string[] = [`Статус: ${statusLabel}`];
      if (balanceNum !== 0)
        descParts.push(`Баланс: ${balanceNum.toLocaleString("ru-RU")} ₽`);
      if (balanceBaseNum !== 0 && balanceBaseNum !== balanceNum)
        descParts.push(
          `Базовый баланс: ${balanceBaseNum.toLocaleString("ru-RU")} ₽`,
        );
      if (paidLessonsNum > 0)
        descParts.push(`Уроков оплачено: ${paidLessonsNum}`);
      if (paidTill) descParts.push(`Оплачено до: ${paidTill}`);
      if (lastAttend) descParts.push(`Последнее занятие: ${lastAttend}`);
      if (nextLesson)
        descParts.push(`Следующее занятие: ${nextLesson.slice(0, 10)}`);

      await db
        .insert(timelineEventsTable)
        .values({
          familyId: familyId ?? undefined,
          personId: guardianPersonId ?? undefined,
          studentPersonId: studentPersonId ?? undefined,
          eventType: "subscription_started",
          eventTime: new Date(eventTime),
          title: `Записан: ${fullName ?? crmId}${ageStr}`,
          description: descParts.join(" · "),
          sourceSystem: "alphaCRM",
          relatedEntityType: "student",
          relatedEntityId: crmId,
          severity: "info",
          raw: {
            student_crm_id: crmId,
            full_name: fullName,
            dob,
            balance,
            balance_base: balanceBase,
            paid_lesson_count: paidLessons,
            paid_till: paidTill,
            study_status_id: studyStatusId,
            last_attend_date: lastAttend,
            next_lesson_date: nextLesson,
            is_study: isStudy,
          },
        })
        .onConflictDoNothing();
      subscriptionsAdded++;
    }

    // ── 3. Attendance → lesson_attended / lesson_missed events ─────────────────
    // Uses enriched raw data from extract-attendance-from-lessons:
    // time_from, time_to, subject_id, reason_name all available in a.raw.
    // Loads subject map from settings for direction name lookup.
    const subjectMapSetting = await db.execute(sql`
    SELECT value FROM settings WHERE key = 'crm_subjects_map' LIMIT 1
  `);
    let subjectMap: Record<string, string> = {};
    try {
      if (subjectMapSetting.rows[0]?.["value"]) {
        subjectMap = JSON.parse(
          subjectMapSetting.rows[0]["value"] as string,
        ) as Record<string, string>;
      }
    } catch {
      /* ignore parse errors */
    }

    const attendance = await db.execute(sql`
    SELECT
      a.id,
      a.lesson_crm_id,
      a.student_crm_id,
      a.status,
      a.raw,
      COALESCE(
        (a.raw->>'lesson_date')::date,
        l.lesson_date
      )                                           AS lesson_date,
      a.raw->>'time_from'                         AS time_from,
      a.raw->>'time_to'                           AS time_to,
      a.raw->>'subject_id'                        AS subject_id,
      a.raw->>'reason_name'                       AS reason_name,
      a.raw->>'note'                              AS attendance_note,
      sp.family_id,
      sp.student_person_id,
      sp.full_name                               AS student_name,
      f.primary_guardian_person_id              AS guardian_person_id
    FROM crm_attendance a
    LEFT JOIN crm_lessons l ON l.crm_id = a.lesson_crm_id
    LEFT JOIN student_profiles sp ON sp.student_crm_id = a.student_crm_id
    LEFT JOIN families f ON f.id = sp.family_id
    WHERE COALESCE((a.raw->>'lesson_date')::date, l.lesson_date) IS NOT NULL
    ORDER BY COALESCE((a.raw->>'lesson_date')::date, l.lesson_date) DESC
  `);

    dbg.attendance.total_in_crm = attendance.rows.length;
    if (attendance.rows.length === 0) {
      dbg.attendance.note =
        "Посещения не извлечены. Нажмите «Извлечь посещения из уроков» в разделе CRM Sync, затем пересоберите историю.";
    }

    for (const row of attendance.rows) {
      const attendanceId = row["id"] as string;
      const lessonDateRaw = row["lesson_date"] as string;
      const timeFromRaw = row["time_from"] as string | null;
      const timeToRaw = row["time_to"] as string | null;
      const subjectId = row["subject_id"] as string | null;
      const reasonName = row["reason_name"] as string | null;
      const attendNote = row["attendance_note"] as string | null;
      const status = row["status"] as string | null;
      const studentCrmId = row["student_crm_id"] as string | null;
      const familyId = row["family_id"] as string | null;
      const guardianPersonId = row["guardian_person_id"] as string | null;
      const studentPersonId = row["student_person_id"] as string | null;
      const studentName = row["student_name"] as string | null;

      if (familyId) dbg.attendance.linked_to_family++;

      // Resolve subject name: map → fallback to "Направление #id"
      const subjectName = subjectId
        ? (subjectMap[subjectId] ?? `Направление #${subjectId}`)
        : "Занятие";

      // Format time range (HH:MM–HH:MM)
      let timeStr = "";
      if (timeFromRaw) {
        const tf = timeFromRaw.slice(11, 16); // "HH:MM"
        const tt = timeToRaw ? timeToRaw.slice(11, 16) : null;
        timeStr = tt ? `${tf}–${tt}` : tf;
      }

      const attended = status === "1";
      const eventType = attended ? "lesson_attended" : "lesson_missed";
      const severity = attended ? "info" : "warning";

      const descParts: string[] = [];
      if (timeStr) descParts.push(timeStr);
      if (!attended && reasonName) descParts.push(`Причина: ${reasonName}`);
      if (!attended && attendNote) descParts.push(attendNote);
      if (studentName) descParts.push(studentName);

      await db
        .insert(timelineEventsTable)
        .values({
          familyId: familyId ?? undefined,
          personId: guardianPersonId ?? undefined,
          studentPersonId: studentPersonId ?? undefined,
          eventType,
          eventTime: new Date(lessonDateRaw),
          title: attended
            ? `Посещение: ${subjectName}`
            : `Пропуск: ${subjectName}`,
          description: descParts.join(" · ") || undefined,
          sourceSystem: "alphaCRM",
          relatedEntityType: "attendance",
          relatedEntityId: attendanceId,
          severity,
          raw: {
            status,
            student_crm_id: studentCrmId,
            student_name: studentName,
            subject_id: subjectId,
            subject_name: subjectName,
            time_from: timeFromRaw,
            time_to: timeToRaw,
            reason_name: reasonName,
          },
        })
        .onConflictDoNothing();
      attendanceAdded++;
    }

    // ── 4. Lead events → lead_created events ────────────────────────────────────
    const leads = await db.execute(sql`
    SELECT
      le.id,
      le.client_name,
      le.phone,
      le.channel,
      le.source,
      le.event_time,
      le.branch_name,
      le.message,
      le.status,
      p.id                                      AS person_id,
      f.id                                      AS family_id
    FROM lead_events le
    LEFT JOIN person_contacts pc
      ON pc.normalized_value = le.phone AND pc.contact_type = 'phone'
    LEFT JOIN persons p
      ON p.id = pc.person_id AND p.is_parent = true
    LEFT JOIN families f
      ON f.primary_guardian_person_id = p.id
    WHERE le.event_time IS NOT NULL
  `);

    for (const row of leads.rows) {
      const leadId = row["id"] as string;
      const clientName = row["client_name"] as string | null;
      const channel = row["channel"] as string | null;
      const source = row["source"] as string | null;
      const eventTime = row["event_time"] as string;
      const familyId = row["family_id"] as string | null;
      const personId = row["person_id"] as string | null;
      const status = row["status"] as string | null;

      await db
        .insert(timelineEventsTable)
        .values({
          familyId: familyId ?? undefined,
          personId: personId ?? undefined,
          eventType: "lead_created",
          eventTime: new Date(eventTime),
          title: `Лид: ${clientName ?? "Неизвестен"}`,
          description:
            [
              channel ? `Канал: ${channel}` : null,
              source ? `Источник: ${source}` : null,
              status ? `Статус: ${status}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          sourceSystem: "alphaCRM",
          relatedEntityType: "lead_event",
          relatedEntityId: leadId,
          severity: "info",
          raw: { client_name: clientName, channel, source, status },
        })
        .onConflictDoNothing();
      leadsAdded++;
    }

    const totalEventsRow = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM timeline_events`,
    );
    const totalEvents = parseInt(
      (totalEventsRow.rows[0]?.["cnt"] as string) ?? "0",
      10,
    );

    // Auto-calculate family health after rebuilding timeline
    const healthResult = await calcAllFamilyHealth();

    res.json({
      paymentsAdded,
      subscriptionsAdded,
      attendanceAdded,
      leadsAdded,
      totalEvents,
      familiesCalculated: healthResult.familiesCalculated,
      alertsCreated: healthResult.alertsCreated,
      debug: dbg,
    });
  },
);

// ─── calcAllFamilyHealth (shared helper) ──────────────────────────────────────
// Calculates health score + alerts for every family and UPSERTS family_health.
// Called from both /identity/calc-health and /identity/build-timeline.

export async function calcAllFamilyHealth(): Promise<{
  familiesCalculated: number;
  alertsCreated: number;
}> {
  const families = await db.select().from(familiesTable);
  const now = new Date();
  let calculated = 0;
  let alertsCreated = 0;

  for (const family of families) {
    // ── Student status breakdown ───────────────────────────────────────────
    const studentRows = await db.execute(sql`
      SELECT s.status, COUNT(*) AS cnt
      FROM student_profiles sp
      JOIN crm_students s ON s.crm_id = sp.student_crm_id
      WHERE sp.family_id = ${family.id}
      GROUP BY s.status
    `);
    let activeStudents = 0;
    let inactiveStudents = 0;
    for (const r of studentRows.rows) {
      const cnt = parseInt(r["cnt"] as string, 10);
      if (r["status"] === "1") activeStudents += cnt;
      else inactiveStudents += cnt;
    }

    // ── Payment stats ─────────────────────────────────────────────────────
    const paymentRows = await db.execute(sql`
      SELECT
        MAX(COALESCE(p.payment_date::timestamp, (p.raw->>'created_at')::timestamp)) AS last_payment,
        COUNT(*)                                                                      AS payment_count,
        SUM(COALESCE(p.amount::numeric, NULLIF(p.raw->>'income', '')::numeric, 0))   AS total_amount
      FROM crm_payments p
      JOIN student_profiles sp ON sp.student_crm_id = p.student_crm_id
      WHERE sp.family_id = ${family.id}
    `);
    const payRow = paymentRows.rows[0];
    const lastPaymentStr = payRow?.["last_payment"] as string | null;
    const paymentCount = parseInt(
      (payRow?.["payment_count"] as string) ?? "0",
      10,
    );
    const lastPaymentAt = lastPaymentStr ? new Date(lastPaymentStr) : null;
    const daysSincePayment = daysSince(lastPaymentAt);

    // ── Attendance stats (last 30d) ────────────────────────────────────────
    const attendanceRows = await db.execute(sql`
      SELECT a.status, COUNT(*) AS cnt
      FROM crm_attendance a
      JOIN student_profiles sp ON sp.student_crm_id = a.student_crm_id
      JOIN crm_lessons l ON l.crm_id = a.lesson_crm_id
      WHERE sp.family_id = ${family.id}
        AND l.lesson_date >= NOW() - INTERVAL '30 days'
      GROUP BY a.status
    `);
    let attended30 = 0;
    let missed30 = 0;
    for (const r of attendanceRows.rows) {
      const cnt = parseInt(r["cnt"] as string, 10);
      if (r["status"] === "1") attended30 += cnt;
      else missed30 += cnt;
    }
    const total30 = attended30 + missed30;

    const lastAttendanceRow = await db.execute(sql`
      SELECT MAX(l.lesson_date) AS last_attendance
      FROM crm_attendance a
      JOIN student_profiles sp ON sp.student_crm_id = a.student_crm_id
      JOIN crm_lessons l ON l.crm_id = a.lesson_crm_id
      WHERE sp.family_id = ${family.id} AND a.status = '1'
    `);
    const lastAttendanceStr = lastAttendanceRow.rows[0]?.["last_attendance"] as
      string | null;
    const lastAttendanceAt = lastAttendanceStr
      ? new Date(lastAttendanceStr)
      : null;

    // ── Score calculation ─────────────────────────────────────────────────
    let paymentScore = 0;
    if (paymentCount > 0) {
      if (daysSincePayment !== null && daysSincePayment <= 30)
        paymentScore = 40;
      else if (daysSincePayment !== null && daysSincePayment <= 60)
        paymentScore = 30;
      else if (daysSincePayment !== null && daysSincePayment <= 90)
        paymentScore = 20;
      else paymentScore = 10;
    }

    let attendanceScore = 20;
    if (total30 > 0) {
      attendanceScore = Math.round((attended30 / total30) * 30);
    }

    const engagementScore =
      activeStudents > 0 ? 20 : activeStudents + inactiveStudents > 0 ? 5 : 0;
    const activeBonus =
      activeStudents > 0 && inactiveStudents === 0
        ? 10
        : activeStudents > 0
          ? 6
          : 0;

    const healthScore = Math.min(
      100,
      paymentScore + attendanceScore + engagementScore + activeBonus,
    );
    const churnRiskScore = parseFloat((1 - healthScore / 100).toFixed(3));

    await db
      .insert(familyHealthTable)
      .values({
        familyId: family.id,
        healthScore: String(healthScore),
        paymentScore: String(paymentScore),
        attendanceScore: String(attendanceScore),
        engagementScore: String(engagementScore),
        churnRiskScore: String(churnRiskScore),
        lastPaymentAt: lastPaymentAt ?? undefined,
        lastAttendanceAt: lastAttendanceAt ?? undefined,
        missedLessons30d: missed30,
        overdueAmount: "0",
        activeStudents,
        inactiveStudents,
        calculatedAt: now,
      })
      .onConflictDoUpdate({
        target: familyHealthTable.familyId,
        set: {
          healthScore: String(healthScore),
          paymentScore: String(paymentScore),
          attendanceScore: String(attendanceScore),
          engagementScore: String(engagementScore),
          churnRiskScore: String(churnRiskScore),
          lastPaymentAt: lastPaymentAt ?? undefined,
          lastAttendanceAt: lastAttendanceAt ?? undefined,
          missedLessons30d: missed30,
          overdueAmount: "0",
          activeStudents,
          inactiveStudents,
          calculatedAt: now,
        },
      });

    await db.execute(sql`
      DELETE FROM health_alerts
      WHERE family_id = ${family.id} AND resolved = false
    `);

    const alerts: Array<{
      alertType: string;
      severity: string;
      message: string;
    }> = [];

    if (paymentCount === 0 && activeStudents > 0) {
      alerts.push({
        alertType: "overdue_payment",
        severity: "critical",
        message: "Нет ни одного платежа для активных учеников",
      });
    } else if (
      daysSincePayment !== null &&
      daysSincePayment > 60 &&
      activeStudents > 0
    ) {
      alerts.push({
        alertType: "overdue_payment",
        severity: "warning",
        message: `Последний платёж ${daysSincePayment} дней назад`,
      });
    }

    if (activeStudents === 0 && inactiveStudents > 0) {
      alerts.push({
        alertType: "inactive_family",
        severity: "warning",
        message: "Все ученики неактивны",
      });
    }

    if (total30 > 0 && missed30 / total30 > 0.4) {
      alerts.push({
        alertType: "attendance_drop",
        severity: "warning",
        message: `Пропущено ${missed30} из ${total30} уроков за 30 дней`,
      });
    }

    if (healthScore < 40) {
      alerts.push({
        alertType: "churn_risk",
        severity: "critical",
        message: `Высокий риск оттока (score: ${healthScore})`,
      });
    } else if (healthScore < 60) {
      alerts.push({
        alertType: "churn_risk",
        severity: "warning",
        message: `Риск оттока (score: ${healthScore})`,
      });
    }

    for (const alert of alerts) {
      await db.insert(healthAlertsTable).values({
        familyId: family.id,
        alertType: alert.alertType,
        severity: alert.severity,
        message: alert.message,
      });
      alertsCreated++;
    }

    calculated++;
  }

  return { familiesCalculated: calculated, alertsCreated };
}

// ─── POST /api/identity/calc-health ──────────────────────────────────────────

timelineRouter.post(
  "/identity/calc-health",
  async (_req, res): Promise<void> => {
    const result = await calcAllFamilyHealth();
    res.json(result);
  },
);

// ─── GET /api/identity/at-risk ────────────────────────────────────────────────

timelineRouter.get("/identity/at-risk", async (req, res): Promise<void> => {
  const { limit = "20" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 20, 100);

  const rows = await db.execute(sql`
    SELECT
      f.id                                                                   AS family_id,
      f.family_name,
      f.primary_phone,
      p.full_name                                                            AS guardian_name,
      fh.health_score,
      fh.payment_score,
      fh.attendance_score,
      fh.churn_risk_score,
      fh.last_payment_at,
      fh.missed_lessons_30d,
      fh.active_students,
      fh.inactive_students,
      fh.calculated_at,
      json_agg(
        json_build_object('full_name', sp.full_name, 'status', sp.status)
        ORDER BY sp.full_name
      )                                                                      AS students,
      json_agg(
        json_build_object('alert_type', ha.alert_type, 'severity', ha.severity, 'message', ha.message)
        ORDER BY ha.severity DESC
      ) FILTER (WHERE ha.id IS NOT NULL AND ha.resolved = false)            AS alerts
    FROM families f
    JOIN family_health fh ON fh.family_id = f.id
    LEFT JOIN persons p ON p.id = f.primary_guardian_person_id
    LEFT JOIN student_profiles sp ON sp.family_id = f.id
    LEFT JOIN health_alerts ha ON ha.family_id = f.id
    GROUP BY f.id, f.family_name, f.primary_phone, p.full_name,
      fh.health_score, fh.payment_score, fh.attendance_score,
      fh.churn_risk_score, fh.last_payment_at, fh.missed_lessons_30d,
      fh.active_students, fh.inactive_students, fh.calculated_at
    ORDER BY fh.health_score ASC
    LIMIT ${lim}
  `);

  res.json({ families: rows.rows, total: rows.rows.length });
});

// ─── GET /api/identity/families/:id/stats ─────────────────────────────────────
// Financial + behavioral stats + AI summary for a single family.

function buildAiSummary(p: {
  daysWithUs: number | null;
  totalStudents: number;
  activeStudents: number;
  paymentCount: number;
  totalPaid: number;
  lastPaymentAt: Date | null;
  attendedTotal: number;
  missedTotal: number;
  healthScore: number | null;
}): string {
  const parts: string[] = [];

  if (p.daysWithUs !== null) {
    const d = p.daysWithUs;
    const w = d === 1 ? "день" : d <= 4 ? "дня" : "дней";
    parts.push(`Семья с нами ${d} ${w}.`);
  }

  if (p.totalStudents === 1) parts.push("1 ребёнок.");
  else if (p.totalStudents === 2) parts.push("2 ребёнка.");
  else if (p.totalStudents >= 3) parts.push(`${p.totalStudents} детей.`);

  if (p.paymentCount > 0) {
    parts.push(`Оплачено ${p.totalPaid.toLocaleString("ru-RU")} ₽.`);
    if (p.lastPaymentAt) {
      const days = Math.floor(
        (Date.now() - p.lastPaymentAt.getTime()) / 86_400_000,
      );
      if (days === 0) parts.push("Последняя оплата сегодня.");
      else if (days === 1) parts.push("Последняя оплата вчера.");
      else if (days <= 14) parts.push(`Последняя оплата ${days} дней назад.`);
      else if (days <= 30) parts.push(`Нет оплаты ${days} дней.`);
      else parts.push(`Нет оплаты ${days} дней — стоит проверить.`);
    }
  } else {
    parts.push("Оплат ещё нет.");
  }

  if (p.attendedTotal > 0) {
    parts.push(`Посещений: ${p.attendedTotal}.`);
    const total = p.attendedTotal + p.missedTotal;
    if (total > 0 && p.missedTotal / total > 0.3) {
      parts.push(`Пропуски: ${Math.round((p.missedTotal / total) * 100)}%.`);
    }
  } else {
    parts.push("Данные о посещаемости не синхронизированы.");
  }

  if (p.healthScore !== null) {
    if (p.healthScore >= 75) parts.push("Риск ухода низкий.");
    else if (p.healthScore >= 50) parts.push("Риск умеренный.");
    else if (p.healthScore >= 25)
      parts.push("Рекомендуется связаться с семьёй.");
    else parts.push("Высокий риск ухода — необходим контакт.");
  }

  return parts.join(" ");
}

timelineRouter.get(
  "/identity/families/:id/stats",
  async (req, res): Promise<void> => {
    const { id } = req.params;

    // Payment stats
    const payRow = await db.execute(sql`
    SELECT
      COUNT(*)                                                                                              AS payment_count,
      SUM(COALESCE(p.amount::numeric, (p.raw->>'income')::numeric, 0))                                   AS total_paid,
      SUM(CASE
        WHEN COALESCE(p.payment_date::timestamp, (p.raw->>'created_at')::timestamp) >= DATE_TRUNC('month', NOW())
        THEN COALESCE(p.amount::numeric, (p.raw->>'income')::numeric, 0)
        ELSE 0
      END)                                                                                                 AS paid_this_month,
      MAX(COALESCE(p.payment_date::timestamp, (p.raw->>'created_at')::timestamp))                        AS last_payment_at
    FROM crm_payments p
    JOIN student_profiles sp ON sp.student_crm_id = p.student_crm_id
    WHERE sp.family_id = ${id}
  `);

    // Last payment amount
    const lastPayRow = await db.execute(sql`
    SELECT COALESCE(p.amount::text, p.raw->>'income') AS amount
    FROM crm_payments p
    JOIN student_profiles sp ON sp.student_crm_id = p.student_crm_id
    WHERE sp.family_id = ${id}
    ORDER BY COALESCE(p.payment_date::timestamp, (p.raw->>'created_at')::timestamp) DESC NULLS LAST
    LIMIT 1
  `);

    // Student stats
    const stuRow = await db.execute(sql`
    SELECT
      COUNT(*)                                                                           AS total_students,
      COUNT(*) FILTER (WHERE s.status = '1')                                            AS active_students,
      MIN(COALESCE(s.created_at_crm, (s.raw->>'created_at')::timestamp, s.synced_at)) AS first_seen_at
    FROM crm_students s
    JOIN student_profiles sp ON sp.student_crm_id = s.crm_id
    WHERE sp.family_id = ${id}
  `);

    // Attendance stats
    const attRow = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE a.status = '1')                          AS attended_total,
      COUNT(*) FILTER (WHERE a.status <> '1')                         AS missed_total,
      MAX(l.lesson_date) FILTER (WHERE a.status = '1')               AS last_attendance_at
    FROM crm_attendance a
    JOIN crm_lessons l ON l.crm_id = a.lesson_crm_id
    JOIN student_profiles sp ON sp.student_crm_id = a.student_crm_id
    WHERE sp.family_id = ${id}
  `);

    // Total timeline events
    const evtRow = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM timeline_events WHERE family_id = ${id}
  `);

    // Health score
    const healthRow = await db.execute(sql`
    SELECT health_score FROM family_health WHERE family_id = ${id}
  `);

    const pay = payRow.rows[0] ?? {};
    const stu = stuRow.rows[0] ?? {};
    const att = attRow.rows[0] ?? {};

    const paymentCount = parseInt((pay["payment_count"] as string) ?? "0", 10);
    const totalPaid = parseFloat((pay["total_paid"] as string) ?? "0");
    const paidThisMonth = parseFloat((pay["paid_this_month"] as string) ?? "0");
    const lastPaymentAt = pay["last_payment_at"]
      ? new Date(pay["last_payment_at"] as string)
      : null;
    const lastPaymentAmount =
      (lastPayRow.rows[0]?.["amount"] as string | null) ?? null;

    const totalStudents = parseInt(
      (stu["total_students"] as string) ?? "0",
      10,
    );
    const activeStudents = parseInt(
      (stu["active_students"] as string) ?? "0",
      10,
    );
    const firstSeenAt = stu["first_seen_at"]
      ? new Date(stu["first_seen_at"] as string)
      : null;
    const daysWithUs = firstSeenAt
      ? Math.floor((Date.now() - firstSeenAt.getTime()) / 86_400_000)
      : null;

    const attendedTotal = parseInt(
      (att["attended_total"] as string) ?? "0",
      10,
    );
    const missedTotal = parseInt((att["missed_total"] as string) ?? "0", 10);
    const lastAttendanceAt =
      (att["last_attendance_at"] as string | null) ?? null;

    const totalEvents = parseInt(
      (evtRow.rows[0]?.["cnt"] as string) ?? "0",
      10,
    );

    const healthScore = healthRow.rows[0]
      ? parseFloat(healthRow.rows[0]["health_score"] as string)
      : null;
    const healthLabel =
      healthScore === null
        ? null
        : healthScore >= 75
          ? "excellent"
          : healthScore >= 50
            ? "good"
            : healthScore >= 25
              ? "warning"
              : "critical";

    const aiSummary = buildAiSummary({
      daysWithUs,
      totalStudents,
      activeStudents,
      paymentCount,
      totalPaid,
      lastPaymentAt,
      attendedTotal,
      missedTotal,
      healthScore,
    });

    res.json({
      total_paid: totalPaid > 0 ? String(totalPaid) : null,
      paid_this_month: paidThisMonth > 0 ? String(paidThisMonth) : null,
      last_payment_at: lastPaymentAt ? lastPaymentAt.toISOString() : null,
      last_payment_amount: lastPaymentAmount,
      payment_count: paymentCount,
      days_with_us: daysWithUs,
      first_seen_at: firstSeenAt ? firstSeenAt.toISOString() : null,
      total_events: totalEvents,
      active_students: activeStudents,
      total_students: totalStudents,
      attended_total: attendedTotal,
      missed_total: missedTotal,
      last_attendance_at: lastAttendanceAt,
      ai_summary: aiSummary,
      health_score:
        healthScore !== null ? String(Math.round(healthScore)) : null,
      health_label: healthLabel,
    });
  },
);

// ─── GET /api/identity/families/:id/timeline ──────────────────────────────────
// Returns timeline events for a family, with student name resolved via raw->>'student_crm_id'.

timelineRouter.get(
  "/identity/families/:id/timeline",
  async (req, res): Promise<void> => {
    const { id } = req.params;
    const {
      event_type,
      limit = "100",
      offset = "0",
    } = req.query as Record<string, string>;
    const lim = Math.min(parseInt(limit, 10) || 100, 500);
    const off = parseInt(offset, 10) || 0;

    const typeFilter = event_type
      ? sql`AND te.event_type = ${event_type}`
      : sql``;

    const rows = await db.execute(sql`
    SELECT
      te.id,
      te.event_type,
      te.event_time,
      te.title,
      te.description,
      te.amount,
      te.source_system,
      te.related_entity_type,
      te.related_entity_id,
      te.severity,
      te.raw,
      COALESCE(
        sp.full_name,
        te.raw->>'student_name'
      )                         AS student_name
    FROM timeline_events te
    LEFT JOIN student_profiles sp
      ON sp.student_crm_id = te.raw->>'student_crm_id'
    WHERE te.family_id = ${id} ${typeFilter}
    ORDER BY te.event_time DESC
    LIMIT ${lim} OFFSET ${off}
  `);

    const countRow = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM timeline_events WHERE family_id = ${id}
  `);

    res.json({
      events: rows.rows,
      total: parseInt((countRow.rows[0]?.["cnt"] as string) ?? "0", 10),
    });
  },
);

// ─── GET /api/identity/families/:id/health ────────────────────────────────────

timelineRouter.get(
  "/identity/families/:id/health",
  async (req, res): Promise<void> => {
    const { id } = req.params;

    const healthRows = await db.execute(sql`
    SELECT
      fh.*,
      f.family_name,
      f.primary_phone,
      p.full_name                                                            AS guardian_name,
      json_agg(
        json_build_object('full_name', sp.full_name, 'status', sp.status, 'branch_crm_id', sp.branch_crm_id)
        ORDER BY sp.full_name
      )                                                                      AS students
    FROM family_health fh
    JOIN families f ON f.id = fh.family_id
    LEFT JOIN persons p ON p.id = f.primary_guardian_person_id
    LEFT JOIN student_profiles sp ON sp.family_id = f.id
    WHERE fh.family_id = ${id}
    GROUP BY fh.id, f.family_name, f.primary_phone, p.full_name
  `);

    if (healthRows.rows.length === 0) {
      res
        .status(404)
        .json({ error: "Health data not found — run calc-health first" });
      return;
    }

    const alertRows = await db.execute(sql`
    SELECT id, alert_type, severity, message, resolved, created_at
    FROM health_alerts
    WHERE family_id = ${id}
    ORDER BY severity DESC, created_at DESC
  `);

    res.json({
      health: healthRows.rows[0],
      alerts: alertRows.rows,
    });
  },
);

// ─── GET /api/identity/timeline-stats ─────────────────────────────────────────

timelineRouter.get(
  "/identity/timeline-stats",
  async (_req, res): Promise<void> => {
    const totals = await db.execute(sql`
    SELECT event_type, COUNT(*) AS cnt
    FROM timeline_events
    GROUP BY event_type
    ORDER BY cnt DESC
  `);

    const healthDist = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE health_score >= 75) AS healthy,
      COUNT(*) FILTER (WHERE health_score >= 50 AND health_score < 75) AS watch,
      COUNT(*) FILTER (WHERE health_score >= 25 AND health_score < 50) AS at_risk,
      COUNT(*) FILTER (WHERE health_score < 25) AS critical,
      COUNT(*) AS total
    FROM family_health
  `);

    const alertCounts = await db.execute(sql`
    SELECT alert_type, severity, COUNT(*) AS cnt
    FROM health_alerts
    WHERE resolved = false
    GROUP BY alert_type, severity
    ORDER BY cnt DESC
  `);

    res.json({
      eventsByType: totals.rows,
      healthDistribution: healthDist.rows[0] ?? {},
      openAlerts: alertCounts.rows,
    });
  },
);
