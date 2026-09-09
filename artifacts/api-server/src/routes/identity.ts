import { Router } from "express";
import { db } from "@workspace/db";
import { normalizePhone } from "@workspace/shared/normalize-phone";
import {
  personsTable,
  personContactsTable,
  personLinksTable,
  identityMatchQueueTable,
  familiesTable,
  studentProfilesTable,
  guardianStudentLinksTable,
  leadEventsTable,
  crmStudentsTable,
  bankTransactionsTable,
  rawEventsTable,
} from "@workspace/db";
import { eq, sql, desc, and, count, isNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const identityRouter = Router();

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase() || null;
}

// ─── Name similarity ──────────────────────────────────────────────────────────

function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1.0;
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = intersection / union;
  const minLen = Math.min(na.length, nb.length);
  let prefixLen = 0;
  while (prefixLen < Math.min(minLen, 4) && na[prefixLen] === nb[prefixLen]) prefixLen++;
  return Math.min(1, jaccard + prefixLen * 0.05);
}

// ─── Core matching engine ─────────────────────────────────────────────────────
// Matches against guardian persons (isParent) preferentially for phone,
// since in AlphaCRM the phone field belongs to the parent/guardian.

interface MatchCandidate {
  personId: string;
  confidence: number;
  reasons: string[];
}

async function findMatchCandidates(opts: {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  preferGuardian?: boolean;
}): Promise<MatchCandidate[]> {
  const candidates = new Map<string, MatchCandidate>();

  const merge = (personId: string, confidence: number, reason: string) => {
    const existing = candidates.get(personId);
    if (existing) {
      existing.confidence = Math.min(1, Math.max(existing.confidence, confidence));
      existing.reasons.push(reason);
    } else {
      candidates.set(personId, { personId, confidence, reasons: [reason] });
    }
  };

  // 1. Phone match — boost confidence if matched person is a guardian
  const normPhone = normalizePhone(opts.phone);
  if (normPhone) {
    const rows = await db
      .select({ personId: personContactsTable.personId, isParent: personsTable.isParent })
      .from(personContactsTable)
      .innerJoin(personsTable, eq(personsTable.id, personContactsTable.personId))
      .where(and(
        eq(personContactsTable.contactType, "phone"),
        eq(personContactsTable.normalizedValue, normPhone),
      ));
    for (const r of rows) {
      const boost = (opts.preferGuardian && r.isParent) ? 0.02 : 0;
      merge(r.personId, 0.95 + boost, `phone:${normPhone}`);
    }

    if (opts.phone && opts.phone !== normPhone) {
      const rawRows = await db
        .select({ personId: personContactsTable.personId })
        .from(personContactsTable)
        .where(and(
          eq(personContactsTable.contactType, "phone"),
          eq(personContactsTable.contactValue, opts.phone),
        ));
      for (const r of rawRows) merge(r.personId, 0.9, `phone_raw:${opts.phone}`);
    }
  }

  // 2. Email match
  const normEmail = normalizeEmail(opts.email);
  if (normEmail) {
    const rows = await db
      .select({ personId: personContactsTable.personId })
      .from(personContactsTable)
      .where(and(
        eq(personContactsTable.contactType, "email"),
        eq(personContactsTable.normalizedValue, normEmail),
      ));
    for (const r of rows) merge(r.personId, 0.85, `email:${normEmail}`);
  }

  // 3. Name similarity — only when phone/email don't match
  if (candidates.size === 0 && opts.name && opts.name.trim().length > 2) {
    const existing = await db.select({ id: personsTable.id, fullName: personsTable.fullName }).from(personsTable);
    for (const p of existing) {
      const sim = nameSimilarity(opts.name, p.fullName);
      if (sim >= 0.6) {
        merge(p.id, 0.6 + (sim - 0.6) * 0.5, `name_sim:${sim.toFixed(2)}`);
      }
    }
  }

  return [...candidates.values()].sort((a, b) => b.confidence - a.confidence);
}

// ─── upsertContact ────────────────────────────────────────────────────────────

async function upsertContact(
  personId: string,
  type: "phone" | "email",
  value: string | null | undefined,
  source: string,
): Promise<void> {
  if (!value) return;
  const normalized = type === "phone" ? normalizePhone(value) : normalizeEmail(value);
  if (!normalized) return;
  await db.insert(personContactsTable).values({
    personId,
    contactType: type,
    contactValue: value,
    normalizedValue: normalized,
    isPrimary: false,
    sourceSystem: source,
  }).onConflictDoNothing();
}

// ─── processLeadEvent ─────────────────────────────────────────────────────────
// In an education CRM, leads are parents/guardians — phone belongs to the parent.
// We match against guardian persons (isParent=true) preferentially.

async function processLeadEvent(leadId: string): Promise<void> {
  const [lead] = await db.select().from(leadEventsTable).where(eq(leadEventsTable.id, leadId));
  if (!lead) return;

  const existing = await db
    .select({ id: personLinksTable.id })
    .from(personLinksTable)
    .where(and(eq(personLinksTable.entityType, "lead"), eq(personLinksTable.entityId, leadId)));
  if (existing.length > 0) return;

  const candidates = await findMatchCandidates({
    phone: lead.phone,
    email: lead.email,
    name: lead.clientName,
    preferGuardian: true,
  });

  const top = candidates[0];

  if (top && top.confidence >= 0.9) {
    await db.insert(personLinksTable).values({
      personId: top.personId,
      entityType: "lead",
      entityId: leadId,
      sourceSystem: lead.sourceSystem,
      confidence: String(top.confidence),
    }).onConflictDoNothing();

    await db.update(personsTable).set({
      lastSeenAt: new Date(),
      isLead: true,
      fullName: lead.clientName ?? undefined,
    }).where(eq(personsTable.id, top.personId));

    await upsertContact(top.personId, "phone", lead.phone, lead.sourceSystem ?? "");
    await upsertContact(top.personId, "email", lead.email, lead.sourceSystem ?? "");

    await db.insert(identityMatchQueueTable).values({
      leadEventId: leadId,
      suggestedPersonId: top.personId,
      matchReason: top.reasons.join(", "),
      confidence: String(top.confidence),
      status: "auto_matched",
    }).onConflictDoNothing();

  } else if (top && top.confidence >= 0.6) {
    await db.insert(identityMatchQueueTable).values({
      leadEventId: leadId,
      suggestedPersonId: top.personId,
      matchReason: top.reasons.join(", "),
      confidence: String(top.confidence),
      status: "manual_review",
    }).onConflictDoNothing();

  } else {
    // New lead → create guardian_person (leads in education CRM are parents)
    const normPhone = normalizePhone(lead.phone);
    const [newPerson] = await db.insert(personsTable).values({
      fullName: lead.clientName ?? null,
      firstSeenAt: lead.eventTime ?? new Date(),
      lastSeenAt: lead.eventTime ?? new Date(),
      primaryPhone: normPhone,
      primaryEmail: normalizeEmail(lead.email),
      confidenceScore: "1.0",
      isLead: true,
      isParent: true,  // leads are guardians in education CRM
    }).returning();

    await upsertContact(newPerson.id, "phone", lead.phone, lead.sourceSystem ?? "");
    await upsertContact(newPerson.id, "email", lead.email, lead.sourceSystem ?? "");

    await db.insert(personLinksTable).values({
      personId: newPerson.id,
      entityType: "lead",
      entityId: leadId,
      sourceSystem: lead.sourceSystem,
      confidence: "1.0",
    }).onConflictDoNothing();

    await db.insert(identityMatchQueueTable).values({
      leadEventId: leadId,
      suggestedPersonId: newPerson.id,
      matchReason: "new_person",
      confidence: "1.0",
      status: "new_person",
    }).onConflictDoNothing();
  }
}

// ─── processCrmStudents ───────────────────────────────────────────────────────
// AlphaCRM model:
//   student.full_name  = child's name
//   student.phone      = guardian/parent phone
//   raw.legal_name     = guardian/parent first name
//
// We create TWO persons per student:
//   • student_person  — the child (isStudent=true, no personal phone)
//   • guardian_person — the parent (isParent=true, holds the phone)
//
// Students sharing the same phone number are siblings → same guardian_person.

async function processCrmStudents(): Promise<{
  processed: number;
  studentsCreated: number;
  guardiansCreated: number;
  guardiansReused: number;
}> {
  const students = await db.select().from(crmStudentsTable);
  let studentsCreated = 0;
  let guardiansCreated = 0;
  let guardiansReused = 0;

  for (const student of students) {
    // ── A. Find or create guardian_person ──────────────────────────────────
    const guardianPhone = student.phone;
    const rawData = student.raw as Record<string, unknown> | null;
    const guardianName = rawData?.["legal_name"] as string | undefined;
    const normPhone = normalizePhone(guardianPhone);

    let guardianPersonId: string | null = null;

    if (normPhone) {
      // Look for an existing person (guardian) with this phone
      const [existingContact] = await db
        .select({ personId: personContactsTable.personId })
        .from(personContactsTable)
        .innerJoin(personsTable, eq(personsTable.id, personContactsTable.personId))
        .where(and(
          eq(personContactsTable.contactType, "phone"),
          eq(personContactsTable.normalizedValue, normPhone),
          eq(personsTable.isParent, true),
        ));

      if (existingContact) {
        guardianPersonId = existingContact.personId;
        guardiansReused++;
      } else {
        const [newGuardian] = await db.insert(personsTable).values({
          fullName: guardianName ?? null,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          primaryPhone: normPhone,
          confidenceScore: "1.0",
          isParent: true,
          isStudent: false,
          isLead: false,
        }).returning();
        await upsertContact(newGuardian.id, "phone", guardianPhone, "alphaCRM");
        guardianPersonId = newGuardian.id;
        guardiansCreated++;
      }
    }

    // ── B. Skip if this student is already linked ───────────────────────────
    const existing = await db
      .select({ id: personLinksTable.id })
      .from(personLinksTable)
      .where(and(
        eq(personLinksTable.entityType, "student"),
        eq(personLinksTable.entityId, student.crmId),
      ));
    if (existing.length > 0) continue;

    // ── C. Create student_person (the child) ───────────────────────────────
    const [studentPerson] = await db.insert(personsTable).values({
      fullName: student.fullName ?? null,
      firstSeenAt: student.createdAtCrm ?? new Date(),
      lastSeenAt: new Date(),
      primaryPhone: null,  // child has no personal phone in AlphaCRM
      confidenceScore: "1.0",
      isStudent: true,
      isParent: false,
      isLead: false,
    }).returning();

    // ── D. Link student_person → CRM record ───────────────────────────────
    await db.insert(personLinksTable).values({
      personId: studentPerson.id,
      entityType: "student",
      entityId: student.crmId,
      sourceSystem: "alphaCRM",
      confidence: "1.0",
    }).onConflictDoNothing();

    // ── E. Link guardian_person → CRM student (guardian_of) ───────────────
    if (guardianPersonId) {
      await db.insert(personLinksTable).values({
        personId: guardianPersonId,
        entityType: "guardian_of",
        entityId: student.crmId,
        sourceSystem: "alphaCRM",
        confidence: "1.0",
      }).onConflictDoNothing();
    }

    // ── F. Upsert student_profile ──────────────────────────────────────────
    const rawPhones = rawData?.["phone"] as unknown[] | undefined;
    const rawDob = rawData?.["dob"] as string | undefined;

    await db.insert(studentProfilesTable).values({
      studentCrmId: student.crmId,
      studentPersonId: studentPerson.id,
      familyId: null,
      fullName: student.fullName ?? null,
      dob: rawDob ?? null,
      branchCrmId: student.branchCrmId ?? null,
      status: student.status ?? null,
      raw: student.raw,
    }).onConflictDoUpdate({
      target: studentProfilesTable.studentCrmId,
      set: {
        studentPersonId: studentPerson.id,
        fullName: student.fullName ?? null,
        branchCrmId: student.branchCrmId ?? null,
        status: student.status ?? null,
        raw: student.raw,
      },
    });

    studentsCreated++;

    void rawPhones; // used only for the profile raw field above
  }

  return { processed: students.length, studentsCreated, guardiansCreated, guardiansReused };
}

// ─── buildFamilies ────────────────────────────────────────────────────────────
// Self-contained idempotent step that:
//   1. Reads all CRM students directly
//   2. Groups them by normalized guardian phone
//   3. Finds or creates guardian_person for each unique phone
//   4. Upserts a Family record (one per guardian_person)
//   5. Upserts student_profile with family_id
//   6. Creates guardian_student_links
//
// Works correctly whether processCrmStudents has been run or not.
// Safe to re-run at any time.

async function buildFamilies(): Promise<{ familiesCreated: number; guardiansCreated: number; linksCreated: number }> {
  const allStudents = await db.select().from(crmStudentsTable);

  // Group by normalized guardian phone
  const phoneGroups = new Map<string, typeof allStudents>();
  for (const s of allStudents) {
    const norm = normalizePhone(s.phone);
    if (!norm) continue;
    if (!phoneGroups.has(norm)) phoneGroups.set(norm, []);
    phoneGroups.get(norm)!.push(s);
  }

  let familiesCreated = 0;
  let guardiansCreated = 0;
  let linksCreated = 0;

  for (const [normPhone, groupStudents] of phoneGroups) {
    const rawData = groupStudents[0].raw as Record<string, unknown> | null;
    const guardianName = rawData?.["legal_name"] as string | undefined;

    // ── Find or create guardian_person ───────────────────────────────────
    const [existingContact] = await db
      .select({ personId: personContactsTable.personId })
      .from(personContactsTable)
      .innerJoin(personsTable, eq(personsTable.id, personContactsTable.personId))
      .where(and(
        eq(personContactsTable.contactType, "phone"),
        eq(personContactsTable.normalizedValue, normPhone),
        eq(personsTable.isParent, true),
      ));

    let guardianPersonId: string;
    if (existingContact) {
      guardianPersonId = existingContact.personId;
    } else {
      const [newGuardian] = await db.insert(personsTable).values({
        fullName: guardianName ?? null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        primaryPhone: normPhone,
        confidenceScore: "1.0",
        isParent: true,
        isStudent: false,
        isLead: false,
      }).returning();
      await upsertContact(newGuardian.id, "phone", groupStudents[0].phone, "alphaCRM");
      guardianPersonId = newGuardian.id;
      guardiansCreated++;
    }

    // ── Upsert family ─────────────────────────────────────────────────────
    const familyName = guardianName
      ? `Семья ${guardianName}`
      : `Семья ${normPhone}`;

    const [family] = await db.insert(familiesTable).values({
      primaryGuardianPersonId: guardianPersonId,
      familyName,
      primaryPhone: normPhone,
    }).onConflictDoUpdate({
      target: familiesTable.primaryGuardianPersonId,
      set: { familyName, primaryPhone: normPhone },
    }).returning();
    if (!family) continue;
    familiesCreated++;

    // ── Process each student in this family group ─────────────────────────
    for (const student of groupStudents) {
      // Get or create student_person
      let studentPersonId: string | null = null;
      const [existingLink] = await db
        .select({ personId: personLinksTable.personId })
        .from(personLinksTable)
        .where(and(
          eq(personLinksTable.entityType, "student"),
          eq(personLinksTable.entityId, student.crmId),
        ));

      if (existingLink) {
        studentPersonId = existingLink.personId;
      } else {
        const [sp] = await db.insert(personsTable).values({
          fullName: student.fullName ?? null,
          firstSeenAt: student.createdAtCrm ?? new Date(),
          lastSeenAt: new Date(),
          primaryPhone: null,
          confidenceScore: "1.0",
          isStudent: true,
          isParent: false,
          isLead: false,
        }).returning();
        studentPersonId = sp.id;
        await db.insert(personLinksTable).values({
          personId: sp.id,
          entityType: "student",
          entityId: student.crmId,
          sourceSystem: "alphaCRM",
          confidence: "1.0",
        }).onConflictDoNothing();
      }

      // Guardian-of link
      await db.insert(personLinksTable).values({
        personId: guardianPersonId,
        entityType: "guardian_of",
        entityId: student.crmId,
        sourceSystem: "alphaCRM",
        confidence: "1.0",
      }).onConflictDoNothing();

      // Upsert student_profile
      const sRaw = student.raw as Record<string, unknown> | null;
      await db.insert(studentProfilesTable).values({
        studentCrmId: student.crmId,
        studentPersonId: studentPersonId ?? undefined,
        familyId: family.id,
        fullName: student.fullName ?? null,
        dob: sRaw?.["dob"] as string | undefined ?? null,
        branchCrmId: student.branchCrmId ?? null,
        status: student.status ?? null,
        raw: student.raw,
      }).onConflictDoUpdate({
        target: studentProfilesTable.studentCrmId,
        set: {
          studentPersonId: studentPersonId ?? undefined,
          familyId: family.id,
          fullName: student.fullName ?? null,
          branchCrmId: student.branchCrmId ?? null,
          status: student.status ?? null,
          raw: student.raw,
        },
      });

      // Guardian-student link
      if (studentPersonId) {
        await db.insert(guardianStudentLinksTable).values({
          guardianPersonId,
          studentPersonId,
          studentCrmId: student.crmId,
          familyId: family.id,
          relationType: "guardian",
          confidence: "1.0",
          sourceSystem: "alphaCRM",
        }).onConflictDoNothing();
        linksCreated++;
      }
    }
  }

  return { familiesCreated, guardiansCreated, linksCreated };
}

// ─── POST /api/identity/run-matching ─────────────────────────────────────────

identityRouter.post("/identity/run-matching", async (req, res): Promise<void> => {
  req.log.info("Identity matching engine started");

  try {
    // 1. Process all unlinked lead events
    const unlinkedLeads = await db
      .select({ id: leadEventsTable.id })
      .from(leadEventsTable)
      .where(sql`${leadEventsTable.id} NOT IN (
        SELECT entity_id::uuid FROM person_links WHERE entity_type = 'lead'
      )`);

    let leadsProcessed = 0;
    for (const lead of unlinkedLeads) {
      await processLeadEvent(lead.id);
      leadsProcessed++;
    }

    // 2. Process CRM students (create student_person + guardian_person pairs)
    const studentResult = await processCrmStudents();

    // 3. Build families (group students by guardian phone)
    const familyResult = await buildFamilies();

    const [{ count: queueSize }] = await db
      .select({ count: count() })
      .from(identityMatchQueueTable)
      .where(eq(identityMatchQueueTable.status, "manual_review"));

    const [{ count: personsTotal }] = await db.select({ count: count() }).from(personsTable);
    const [{ count: familiesTotal }] = await db.select({ count: count() }).from(familiesTable);

    req.log.info(
      { leadsProcessed, ...studentResult, ...familyResult, queueSize },
      "Identity matching complete",
    );

    res.json({
      leadsProcessed,
      studentsProcessed: studentResult.processed,
      studentsCreated: studentResult.studentsCreated,
      guardiansCreated: studentResult.guardiansCreated,
      guardiansReused: studentResult.guardiansReused,
      familiesCreated: familyResult.familiesCreated,
      familyLinksCreated: familyResult.linksCreated,
      manualReviewQueue: Number(queueSize),
      personsTotal: Number(personsTotal),
      familiesTotal: Number(familiesTotal),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Identity matching failed");
    res.status(500).json({ error: message });
  }
});

// ─── POST /api/identity/build-families ───────────────────────────────────────
// Run family grouping without re-running the full matching engine.

identityRouter.post("/identity/build-families", async (req, res): Promise<void> => {
  try {
    const result = await buildFamilies();
    const [{ count: familiesTotal }] = await db.select({ count: count() }).from(familiesTable);
    res.json({ ...result, familiesTotal: Number(familiesTotal) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── GET /api/identity/stats ──────────────────────────────────────────────────

identityRouter.get("/identity/stats", async (req, res): Promise<void> => {
  const [
    [personsRow],
    [leadsRow],
    [studentsRow],
    [guardiansRow],
    [queueRow],
    [autoRow],
    [unmatchedLeadsRow],
    [orphanStudentsRow],
    [familiesRow],
  ] = await Promise.all([
    db.select({ count: count() }).from(personsTable),
    db.select({ count: count() }).from(personsTable).where(eq(personsTable.isLead, true)),
    db.select({ count: count() }).from(personsTable).where(eq(personsTable.isStudent, true)),
    db.select({ count: count() }).from(personsTable).where(eq(personsTable.isParent, true)),
    db.select({ count: count() }).from(identityMatchQueueTable).where(eq(identityMatchQueueTable.status, "manual_review")),
    db.select({ count: count() }).from(identityMatchQueueTable).where(eq(identityMatchQueueTable.status, "auto_matched")),
    db.select({ count: count() }).from(leadEventsTable).where(
      sql`${leadEventsTable.id} NOT IN (SELECT entity_id::uuid FROM person_links WHERE entity_type = 'lead')`
    ),
    db.select({ count: count() }).from(crmStudentsTable).where(
      sql`${crmStudentsTable.crmId} NOT IN (SELECT entity_id FROM person_links WHERE entity_type = 'student')`
    ),
    db.select({ count: count() }).from(familiesTable),
  ]);

  res.json({
    personsTotal: Number(personsRow?.count ?? 0),
    personsWithLead: Number(leadsRow?.count ?? 0),
    personsWithStudent: Number(studentsRow?.count ?? 0),
    personsWithGuardian: Number(guardiansRow?.count ?? 0),
    manualReviewQueue: Number(queueRow?.count ?? 0),
    autoMatchedTotal: Number(autoRow?.count ?? 0),
    unmatchedLeads: Number(unmatchedLeadsRow?.count ?? 0),
    orphanStudents: Number(orphanStudentsRow?.count ?? 0),
    familiesTotal: Number(familiesRow?.count ?? 0),
  });
});

// ─── GET /api/identity/persons ────────────────────────────────────────────────

identityRouter.get("/identity/persons", async (req, res): Promise<void> => {
  const { limit = "50", offset = "0", search } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  const conditions = [];
  if (search) {
    conditions.push(sql`(
      ${personsTable.fullName} ILIKE ${"%" + search + "%"}
      OR ${personsTable.primaryPhone} ILIKE ${"%" + search + "%"}
      OR ${personsTable.primaryEmail} ILIKE ${"%" + search + "%"}
    )`);
  }

  const rows = await db
    .select()
    .from(personsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(personsTable.lastSeenAt))
    .limit(lim)
    .offset(off);

  const [{ count: total }] = await db
    .select({ count: count() })
    .from(personsTable)
    .where(conditions.length ? and(...conditions) : undefined);

  res.json({ persons: rows, total: Number(total) });
});

// ─── GET /api/identity/persons/:id ───────────────────────────────────────────

identityRouter.get("/identity/persons/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [person] = await db.select().from(personsTable).where(eq(personsTable.id, id));
  if (!person) { res.status(404).json({ error: "Person not found" }); return; }

  const contacts = await db.select().from(personContactsTable).where(eq(personContactsTable.personId, id));
  const links = await db.select().from(personLinksTable).where(eq(personLinksTable.personId, id));

  // If guardian, include family info
  const [family] = await db.select().from(familiesTable)
    .where(eq(familiesTable.primaryGuardianPersonId, id));

  // Guardian-student links if applicable
  const guardianLinks = await db.select().from(guardianStudentLinksTable)
    .where(eq(guardianStudentLinksTable.guardianPersonId, id));

  res.json({ person, contacts, links, family: family ?? null, guardianLinks });
});

// ─── GET /api/identity/queue ──────────────────────────────────────────────────

identityRouter.get("/identity/queue", async (req, res): Promise<void> => {
  const { status = "manual_review", limit = "50", offset = "0" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  const rows = await db
    .select()
    .from(identityMatchQueueTable)
    .where(eq(identityMatchQueueTable.status, status))
    .orderBy(desc(identityMatchQueueTable.createdAt))
    .limit(lim)
    .offset(off);

  const [{ count: total }] = await db
    .select({ count: count() })
    .from(identityMatchQueueTable)
    .where(eq(identityMatchQueueTable.status, status));

  const enriched = await Promise.all(rows.map(async (item) => {
    let lead = null;
    let suggestedPerson = null;
    if (item.leadEventId) {
      [lead] = await db.select().from(leadEventsTable).where(eq(leadEventsTable.id, item.leadEventId));
    }
    if (item.suggestedPersonId) {
      [suggestedPerson] = await db.select().from(personsTable).where(eq(personsTable.id, item.suggestedPersonId));
    }
    return { ...item, lead, suggestedPerson };
  }));

  res.json({ items: enriched, total: Number(total) });
});

// ─── PATCH /api/identity/queue/:id ───────────────────────────────────────────

identityRouter.patch("/identity/queue/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { action } = req.body as { action: "approve" | "reject" | "new_person" };

  const [item] = await db.select().from(identityMatchQueueTable).where(eq(identityMatchQueueTable.id, id));
  if (!item) { res.status(404).json({ error: "Queue item not found" }); return; }

  if (action === "approve" && item.suggestedPersonId && item.leadEventId) {
    await db.insert(personLinksTable).values({
      personId: item.suggestedPersonId,
      entityType: "lead",
      entityId: item.leadEventId,
      sourceSystem: "manual_review",
      confidence: "1.0",
    }).onConflictDoNothing();

    await db.update(personsTable)
      .set({ isLead: true, lastSeenAt: new Date() })
      .where(eq(personsTable.id, item.suggestedPersonId));

    await db.update(identityMatchQueueTable)
      .set({ status: "auto_matched", resolvedAt: new Date(), resolvedBy: "manual" })
      .where(eq(identityMatchQueueTable.id, id));

  } else if (action === "reject") {
    await db.update(identityMatchQueueTable)
      .set({ status: "rejected", resolvedAt: new Date(), resolvedBy: "manual" })
      .where(eq(identityMatchQueueTable.id, id));

  } else if (action === "new_person" && item.leadEventId) {
    const [lead] = await db.select().from(leadEventsTable).where(eq(leadEventsTable.id, item.leadEventId));
    if (lead) {
      const [newPerson] = await db.insert(personsTable).values({
        fullName: lead.clientName ?? null,
        firstSeenAt: lead.eventTime ?? new Date(),
        lastSeenAt: new Date(),
        primaryPhone: normalizePhone(lead.phone),
        primaryEmail: normalizeEmail(lead.email),
        confidenceScore: "1.0",
        isLead: true,
        isParent: true,
      }).returning();

      await upsertContact(newPerson.id, "phone", lead.phone, lead.sourceSystem ?? "");
      await upsertContact(newPerson.id, "email", lead.email, lead.sourceSystem ?? "");

      await db.insert(personLinksTable).values({
        personId: newPerson.id,
        entityType: "lead",
        entityId: item.leadEventId,
        sourceSystem: "manual_review",
        confidence: "1.0",
      }).onConflictDoNothing();

      await db.update(identityMatchQueueTable)
        .set({ status: "new_person", resolvedAt: new Date(), resolvedBy: "manual", suggestedPersonId: newPerson.id })
        .where(eq(identityMatchQueueTable.id, id));
    }
  }

  res.json({ success: true });
});

// ─── GET /api/identity/unmatched-leads ───────────────────────────────────────

identityRouter.get("/identity/unmatched-leads", async (req, res): Promise<void> => {
  const { limit = "50" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);

  const rows = await db
    .select()
    .from(leadEventsTable)
    .where(sql`${leadEventsTable.id} NOT IN (
      SELECT entity_id::uuid FROM person_links WHERE entity_type = 'lead'
    )`)
    .orderBy(desc(leadEventsTable.createdAt))
    .limit(lim);

  res.json(rows);
});

// ─── GET /api/identity/orphan-students ───────────────────────────────────────

identityRouter.get("/identity/orphan-students", async (req, res): Promise<void> => {
  const { limit = "50" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);

  const rows = await db
    .select()
    .from(crmStudentsTable)
    .where(sql`${crmStudentsTable.crmId} NOT IN (
      SELECT entity_id FROM person_links WHERE entity_type = 'student'
    )`)
    .orderBy(desc(crmStudentsTable.syncedAt))
    .limit(lim);

  res.json(rows);
});

// ─── GET /api/identity/duplicates ─────────────────────────────────────────────
// Returns two categories:
//   realDuplicates   — persons sharing phone/email that are NOT in the same family
//   familyGroups     — guardian_persons that are correctly the same contact
//                      (in practice this should now be empty since we reuse guardian_person)

identityRouter.get("/identity/duplicates", async (req, res): Promise<void> => {
  // All persons sharing a normalized phone, annotated with family membership
  const rows = await db.execute(sql`
    SELECT
      c.normalized_value,
      c.contact_type,
      array_agg(DISTINCT c.person_id::text ORDER BY c.person_id::text) AS person_ids,
      count(DISTINCT c.person_id) AS person_count,
      -- Check if ALL sharing persons are guardian_persons belonging to families
      bool_and(p.is_parent) AS all_are_guardians,
      count(DISTINCT f.id) AS family_count
    FROM person_contacts c
    JOIN persons p ON p.id = c.person_id
    LEFT JOIN families f ON f.primary_guardian_person_id = c.person_id
    WHERE c.normalized_value IS NOT NULL
    GROUP BY c.normalized_value, c.contact_type
    HAVING count(DISTINCT c.person_id) > 1
    ORDER BY person_count DESC
    LIMIT 100
  `);

  const realDuplicates = rows.rows.filter(
    (r) => !r["all_are_guardians"],
  );
  const familyGroups = rows.rows.filter(
    (r) => r["all_are_guardians"],
  );

  res.json({ realDuplicates, familyGroups, total: rows.rows.length });
});

// ─── GET /api/identity/families ───────────────────────────────────────────────

identityRouter.get("/identity/families", async (req, res): Promise<void> => {
  const { limit = "100", offset = "0", search } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 100, 500);
  const off = parseInt(offset, 10) || 0;

  const searchClause = search
    ? sql`AND (f.family_name ILIKE ${"%" + search + "%"} OR f.primary_phone ILIKE ${"%" + search + "%"} OR p.full_name ILIKE ${"%" + search + "%"})`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      f.id,
      f.family_name,
      f.primary_phone,
      f.created_at,
      p.id            AS guardian_person_id,
      p.full_name     AS guardian_name,
      p.is_lead       AS guardian_is_lead,
      count(DISTINCT sp.id) AS student_count,
      json_agg(
        json_build_object(
          'student_crm_id',  sp.student_crm_id,
          'full_name',       sp.full_name,
          'branch_crm_id',   sp.branch_crm_id,
          'status',          sp.status,
          'dob',             sp.dob
        ) ORDER BY sp.full_name
      ) FILTER (WHERE sp.id IS NOT NULL) AS students,
      -- Health scores (from calc-health, may be null)
      fh.health_score,
      fh.churn_risk_score,
      fh.missed_lessons_30d,
      fh.active_students,
      -- Timeline-derived stats (always available after build-timeline)
      COALESCE(
        fh.last_payment_at,
        (SELECT MAX(te.event_time) FROM timeline_events te
         WHERE te.family_id = f.id AND te.event_type = 'payment_received')
      ) AS last_payment_at,
      COALESCE(
        fh.last_attendance_at,
        (SELECT MAX(te.event_time) FROM timeline_events te
         WHERE te.family_id = f.id AND te.event_type IN ('lesson_attended', 'lesson_missed'))
      ) AS last_attendance_at,
      (SELECT COUNT(*)::int FROM timeline_events te WHERE te.family_id = f.id) AS total_events,
      (SELECT COUNT(*)::int FROM timeline_events te
       WHERE te.family_id = f.id AND te.event_type = 'payment_received') AS payment_events,
      (SELECT COUNT(*)::int FROM timeline_events te
       WHERE te.family_id = f.id AND te.event_type = 'lesson_attended') AS attended_events,
      (SELECT COUNT(*)::int FROM timeline_events te
       WHERE te.family_id = f.id AND te.event_type = 'lesson_missed') AS missed_events,
      (SELECT COUNT(*)::int FROM timeline_events te
       WHERE te.family_id = f.id AND te.event_type = 'lesson_attended'
         AND te.event_time >= NOW() - INTERVAL '30 days') AS attended_30d,
      (SELECT COUNT(*)::int FROM timeline_events te
       WHERE te.family_id = f.id AND te.event_type = 'lesson_missed'
         AND te.event_time >= NOW() - INTERVAL '30 days') AS missed_30d,
      -- Alerts
      (SELECT json_agg(json_build_object(
        'alert_type', ha.alert_type,
        'severity',   ha.severity,
        'message',    ha.message
      )) FROM health_alerts ha
       WHERE ha.family_id = f.id AND ha.resolved = false) AS alerts
    FROM families f
    JOIN persons p ON p.id = f.primary_guardian_person_id
    LEFT JOIN student_profiles sp ON sp.family_id = f.id
    LEFT JOIN family_health fh ON fh.family_id = f.id
    WHERE true ${searchClause}
    GROUP BY f.id, f.family_name, f.primary_phone, f.created_at, p.id, p.full_name, p.is_lead,
             fh.health_score, fh.churn_risk_score, fh.missed_lessons_30d, fh.active_students,
             fh.last_payment_at, fh.last_attendance_at
    ORDER BY student_count DESC, f.family_name
    LIMIT ${lim} OFFSET ${off}
  `);

  const [{ count: total }] = await db.select({ count: count() }).from(familiesTable);

  res.json({ families: rows.rows, total: Number(total) });
});

// ─── GET /api/identity/families/:id ───────────────────────────────────────────
// Full family card: guardian + children + payments + lessons

identityRouter.get("/identity/families/:id", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [family] = await db.select().from(familiesTable).where(eq(familiesTable.id, id));
  if (!family) { res.status(404).json({ error: "Family not found" }); return; }

  const [guardian] = await db.select().from(personsTable)
    .where(eq(personsTable.id, family.primaryGuardianPersonId ?? ""));

  const students = await db.execute(sql`
    SELECT
      sp.student_crm_id,
      sp.full_name,
      sp.branch_crm_id,
      sp.status,
      sp.dob,
      -- Payment summary
      (SELECT COALESCE(sum(pay.amount::numeric), 0)
       FROM crm_payments pay
       WHERE pay.student_crm_id = sp.student_crm_id) AS total_paid,
      -- Lesson count
      (SELECT count(*)
       FROM crm_lessons les
       WHERE les.student_crm_id = sp.student_crm_id) AS lesson_count,
      (SELECT count(*)
       FROM crm_attendance att
       WHERE att.student_crm_id = sp.student_crm_id AND att.mark = 1) AS attended_count
    FROM student_profiles sp
    WHERE sp.family_id = ${id}
    ORDER BY sp.full_name
  `);

  // Total revenue for this family
  const paymentsResult = await db.execute(sql`
    SELECT COALESCE(sum(pay.amount::numeric), 0) AS family_total_paid
    FROM crm_payments pay
    JOIN student_profiles sp ON sp.student_crm_id = pay.student_crm_id
    WHERE sp.family_id = ${id}
  `);
  const paymentsRow = paymentsResult.rows[0];

  const guardianLinks = await db.select().from(guardianStudentLinksTable)
    .where(eq(guardianStudentLinksTable.familyId, id));

  res.json({
    family,
    guardian: guardian ?? null,
    students: students.rows,
    guardianLinks,
    familyTotalPaid: paymentsRow ? Number(paymentsRow["family_total_paid"]) : 0,
  });
});

// ─── Phone validation ─────────────────────────────────────────────────────────

function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

// ─── GET /api/identity/quality-check ─────────────────────────────────────────

identityRouter.get("/identity/quality-check", async (req, res): Promise<void> => {
  const { section, format } = req.query as Record<string, string>;

  const studentsWithoutPhone = await db.execute(sql`
    SELECT crm_id, full_name, phone, email, branch_crm_id,
      raw->>'legal_name' AS parent_name,
      raw->'phone' AS raw_phones
    FROM crm_students
    WHERE phone IS NULL OR phone = ''
    ORDER BY full_name LIMIT 200
  `);

  const studentsInvalidPhone = await db.execute(sql`
    SELECT crm_id, full_name, phone, email, branch_crm_id,
      raw->>'legal_name' AS parent_name,
      raw->'phone' AS raw_phones
    FROM crm_students
    WHERE phone IS NOT NULL AND phone != ''
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) NOT BETWEEN 10 AND 15
    ORDER BY full_name LIMIT 200
  `);

  // In education CRM, shared phone = siblings/family — expected and correct
  const familyGroups = await db.execute(sql`
    SELECT
      s.phone,
      count(*) AS student_count,
      array_agg(json_build_object(
        'crm_id', s.crm_id,
        'full_name', s.full_name,
        'branch_crm_id', s.branch_crm_id,
        'parent_name', s.raw->>'legal_name'
      ) ORDER BY s.full_name) AS students,
      f.id AS family_id,
      f.family_name
    FROM crm_students s
    LEFT JOIN student_profiles sp ON sp.student_crm_id = s.crm_id
    LEFT JOIN families f ON f.id = sp.family_id
    WHERE s.phone IS NOT NULL AND s.phone != ''
    GROUP BY s.phone, f.id, f.family_name
    HAVING count(*) > 1
    ORDER BY student_count DESC LIMIT 100
  `);

  const personsStudentOnly = await db.execute(sql`
    SELECT p.id, p.full_name, p.primary_phone, p.primary_email,
      p.first_seen_at, p.last_seen_at, p.confidence_score
    FROM persons p
    WHERE p.is_student = true AND (p.is_lead IS NULL OR p.is_lead = false)
    ORDER BY p.last_seen_at DESC LIMIT 200
  `);

  const personsLeadOnly = await db.execute(sql`
    SELECT p.id, p.full_name, p.primary_phone, p.primary_email,
      p.first_seen_at, p.last_seen_at, p.confidence_score
    FROM persons p
    WHERE p.is_lead = true AND (p.is_student IS NULL OR p.is_student = false)
    ORDER BY p.last_seen_at DESC LIMIT 200
  `);

  const personsBothStudentAndLead = await db.execute(sql`
    SELECT p.id, p.full_name, p.primary_phone, p.primary_email,
      p.first_seen_at, p.last_seen_at, p.confidence_score
    FROM persons p
    WHERE p.is_student = true AND p.is_lead = true
    ORDER BY p.last_seen_at DESC LIMIT 200
  `);

  const studentsLinkedToPerson = await db.execute(sql`
    SELECT s.crm_id, s.full_name, s.phone, s.branch_crm_id,
      raw->>'legal_name' AS parent_name,
      pl.person_id::text,
      pl.confidence,
      p.full_name AS person_full_name,
      p.primary_phone AS person_phone,
      p.is_lead, p.is_student
    FROM crm_students s
    JOIN person_links pl ON pl.entity_id = s.crm_id AND pl.entity_type = 'student'
    JOIN persons p ON p.id = pl.person_id
    ORDER BY s.full_name LIMIT 200
  `);

  const possiblePhoneMismatch = await db.execute(sql`
    SELECT crm_id, full_name, phone AS stored_phone,
      raw->'phone'->>0 AS raw_first_phone,
      raw->>'legal_name' AS parent_name,
      raw->'phone' AS all_raw_phones
    FROM crm_students
    WHERE raw->'phone' IS NOT NULL
      AND jsonb_array_length(raw->'phone') > 0
      AND (
        phone IS DISTINCT FROM raw->'phone'->>0
        OR jsonb_array_length(raw->'phone') > 1
      )
    ORDER BY full_name LIMIT 200
  `);

  const result = {
    studentsWithoutPhone: { count: studentsWithoutPhone.rows.length, records: studentsWithoutPhone.rows },
    studentsInvalidPhone: { count: studentsInvalidPhone.rows.length, records: studentsInvalidPhone.rows },
    familyGroups: { count: familyGroups.rows.length, groups: familyGroups.rows },
    personsStudentOnly: { count: personsStudentOnly.rows.length, records: personsStudentOnly.rows },
    personsLeadOnly: { count: personsLeadOnly.rows.length, records: personsLeadOnly.rows },
    personsBothStudentAndLead: { count: personsBothStudentAndLead.rows.length, records: personsBothStudentAndLead.rows },
    studentsLinkedToPerson: { count: studentsLinkedToPerson.rows.length, records: studentsLinkedToPerson.rows },
    possiblePhoneMismatch: { count: possiblePhoneMismatch.rows.length, records: possiblePhoneMismatch.rows },
  };

  if (format === "csv" && section && section in result) {
    const sectionData = result[section as keyof typeof result];
    const rows = "groups" in sectionData
      ? (sectionData as { count: number; groups: Record<string, unknown>[] }).groups
      : (sectionData as { count: number; records: Record<string, unknown>[] }).records;

    if (rows.length === 0) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${section}.csv"`);
      res.send("no data\n");
      return;
    }
    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        headers.map((h) => {
          const v = r[h];
          const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${section}.csv"`);
    res.send(csvLines.join("\n"));
    return;
  }

  res.json(result);
});

// ─── GET /api/identity/student-raw-preview ────────────────────────────────────

identityRouter.get("/identity/student-raw-preview", async (req, res): Promise<void> => {
  const { limit = "200", search } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit, 10) || 200, 500);

  const searchClause = search
    ? sql`AND (s.full_name ILIKE ${"%" + search + "%"} OR s.phone ILIKE ${"%" + search + "%"} OR raw->>'legal_name' ILIKE ${"%" + search + "%"})`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      s.crm_id,
      s.full_name,
      s.phone AS stored_phone,
      s.email,
      s.branch_crm_id,
      s.status,
      raw->>'legal_name' AS parent_name,
      raw->>'legal_type' AS legal_type,
      raw->'phone' AS raw_phones,
      raw->'contacts' AS raw_contacts,
      raw->>'dob' AS dob,
      raw->>'note' AS note,
      CASE WHEN pl.id IS NOT NULL THEN true ELSE false END AS is_linked,
      pl.person_id::text AS linked_person_id,
      p.full_name AS linked_person_name,
      sp.family_id::text,
      f.family_name
    FROM crm_students s
    LEFT JOIN person_links pl ON pl.entity_id = s.crm_id AND pl.entity_type = 'student'
    LEFT JOIN persons p ON p.id = pl.person_id
    LEFT JOIN student_profiles sp ON sp.student_crm_id = s.crm_id
    LEFT JOIN families f ON f.id = sp.family_id
    WHERE true ${searchClause}
    ORDER BY s.full_name
    LIMIT ${lim}
  `);

  res.json(rows.rows);
});

// ─── Unused import silencer ───────────────────────────────────────────────────
void bankTransactionsTable;
void rawEventsTable;
void isNull;
void isValidPhone;
