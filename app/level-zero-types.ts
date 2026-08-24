export type Role = "director" | "deputy" | "admin" | "teacher" | "parent" | "student" | "tech_admin";

export const roleLabels: Record<Role, string> = {
  director: "Директор",
  deputy: "Завуч",
  admin: "Администратор школы",
  parent: "Родитель",
  teacher: "Учитель",
  student: "Ученик",
  tech_admin: "Технический администратор",
};

export type Viewer = {
  id: string;
  email: string;
  phone?: string;
  displayName: string;
  role: Role;
  initials: string;
  availableRoles: Role[];
};

export type StudentRecord = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  className: string;
  birthYear: number | null;
  avatarColor: string;
};

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  linkedStudentId: string | null;
  status: string;
  profileStatus: "confirmed" | "unconfirmed" | "vacant" | "needs_confirmation" | "demo" | string;
  notes: string;
};

export type ProgramRecord = {
  id: string;
  academicYear: string;
  className: string;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  teacherName: string;
  title: string;
  status: "draft" | "review" | "changes_requested" | "approved" | "active" | "archived" | string;
  plannedLessons: number;
  completedLessons: number;
  updatedAt: string;
};

export type AttendanceRecord = {
  id: string;
  lessonId: string;
  studentId: string;
  status: "present" | "absent" | "late" | "excused" | string;
  note: string | null;
  markedAt: string;
};

export type NotificationRecord = {
  id: string;
  category: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  critical: boolean;
  readAt: string | null;
  createdAt: string;
};

export type ClassRecord = {
  id: string;
  name: string;
  grade: number;
  homeroomTeacherUserId: string | null;
  homeroomTeacherName: string | null;
  status: string;
};

export type SubjectRecord = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  icon: string;
  stage: string;
  weeklyHours: number;
};

export type LessonRecord = {
  id: string;
  className: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  teacherUserId: string | null;
  teacherName: string | null;
  room: string;
  status: string;
  note: string | null;
};

export type TeacherAssignmentRecord = {
  id: string;
  teacherUserId: string;
  teacherName: string;
  teacherProfileStatus: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  status: string;
  notes: string;
};

export type GradeRecord = {
  id: string;
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  teacherUserId: string;
  teacherName: string;
  value: number;
  weight: number;
  title: string;
  gradeDate: string;
  comment: string | null;
};

export type HomeworkRecord = {
  id: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  teacherUserId: string;
  teacherName: string;
  title: string;
  description: string;
  dueAt: string;
  status: string;
};

export type AchievementRecord = {
  id: string;
  studentId: string;
  studentName: string;
  teacherUserId: string;
  teacherName: string;
  title: string;
  description: string;
  category: string;
  achievementDate: string;
};

export type TeacherCommentRecord = {
  id: string;
  studentId: string;
  studentName: string;
  teacherUserId: string;
  teacherName: string;
  subjectId: string | null;
  subjectName: string | null;
  body: string;
  visibility: string;
  commentDate: string;
};

export type MenuRecord = {
  id: string;
  dayDate: string;
  breakfast: string;
  lunch: string;
  snack: string;
  allergens: string;
};

export type EventRecord = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  location: string;
  audience: string;
  status: string;
  capacity: number | null;
};

export type ActivityRecord = {
  id: string;
  title: string;
  schedule: string;
  teacher: string;
  price: number;
  capacity: number;
  enrolled: number;
  status: string;
};

export type SubscriptionRecord = {
  id: string;
  studentId: string;
  name: string;
  period: string;
  status: string;
  balance: number;
  lessonsLeft: number;
  renewalAt: string | null;
};

export type ThreadRecord = {
  id: string;
  studentId: string;
  studentName: string;
  parentUserId: string;
  parentName: string;
  teacherUserId: string;
  teacherName: string;
  title: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  threadId: string;
  authorUserId: string;
  authorName: string;
  authorRole: Role;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type AuditRecord = {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
};

export type RegistrationRequestRecord = {
  id: string;
  email: string;
  displayName: string;
  requestedRole: "parent" | "student";
  studentFirstName: string;
  studentLastName: string;
  className: string;
  relation: string;
  studentId: string | null;
  status: string;
  createdAt: string;
};

export type InvitationRecord = {
  id: string;
  targetRole: "parent" | "student";
  studentId: string | null;
  studentName: string | null;
  className: string | null;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  status: string;
  createdAt: string;
};

export type RankingEntryRecord = {
  position: number;
  studentId: string | null;
  displayName: string | null;
  animal: string | null;
  animalLabel: string | null;
  isOwn: boolean;
  score: number | null;
  gradeCount: number | null;
};

export type RankingTableRecord = {
  id: string;
  subjectId: string | null;
  label: string;
  minimumEvidence: string;
  totalStudents: number;
  eligibleStudents: number;
  ownPosition: number | null;
  ownScore: number | null;
  entries: RankingEntryRecord[];
};

export type ClassRankingRecord = {
  className: string;
  overall: RankingTableRecord;
  subjects: RankingTableRecord[];
};

export type RankingSnapshot = {
  mode: "named" | "anonymous" | "none";
  classes: ClassRankingRecord[];
  privacyNote: string;
};

export type SchoolSnapshot = {
  school: {
    name: string;
    academicYear: string;
    timezone: string;
    dataMode: "template" | "live";
  };
  viewer: Viewer;
  selectedStudent: StudentRecord | null;
  students: StudentRecord[];
  users: UserRecord[];
  classes: ClassRecord[];
  subjects: SubjectRecord[];
  teacherAssignments: TeacherAssignmentRecord[];
  lessons: LessonRecord[];
  grades: GradeRecord[];
  homework: HomeworkRecord[];
  achievements: AchievementRecord[];
  comments: TeacherCommentRecord[];
  menu: MenuRecord[];
  events: EventRecord[];
  activities: ActivityRecord[];
  subscriptions: SubscriptionRecord[];
  threads: ThreadRecord[];
  messages: MessageRecord[];
  audit: AuditRecord[];
  registrationRequests: RegistrationRequestRecord[];
  invitations: InvitationRecord[];
  programs: ProgramRecord[];
  attendance: AttendanceRecord[];
  notifications: NotificationRecord[];
  rankings: RankingSnapshot;
  setup: {
    liveUserCount: number;
    templateRecords: boolean;
    checklist: Array<{ id: string; label: string; done: boolean }>;
  };
};

export type ActionKind =
  | "grade.create"
  | "homework.create"
  | "achievement.create"
  | "comment.create"
  | "message.send"
  | "family.invite.create"
  | "family.registration.claim"
  | "family.registration.request"
  | "family.registration.approve"
  | "user.invite"
  | "user.password.reset"
  | "student.create"
  | "lesson.upsert"
  | "lesson.delete"
  | "lesson.copy-day"
  | "event.create"
  | "menu.update"
  | "activity.create"
  | "subscription.upsert"
  | "program.upsert"
  | "attendance.mark"
  | "notification.read"
  | "menu.rate"
  | "thread.view";
