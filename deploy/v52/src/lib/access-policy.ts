import type { ModuleId } from "../data/test-snapshot";

export const API_ROLES = [
  "OWNER", "DIRECTOR", "ADMIN", "DEPUTY", "FINANCE", "ACCOUNTING", "HR", "SALES", "MARKETING",
  "TEACHER", "METHODIST", "KITCHEN", "PROCUREMENT", "SAFETY", "MEDICAL", "LEGAL", "INTEGRATIONS",
  "ANALYTICS", "PROJECTS", "EMPLOYEE", "QUALITY",
] as const;

export type ApiRole = (typeof API_ROLES)[number];

export type AccessPolicyContext = {
  apiRole: string;
  isSystemOwner: boolean;
  canAccessMedical?: boolean;
  /** Undefined keeps the legacy role template; an array is the owner's explicit section assignment. */
  allowedModules?: readonly string[];
};

export type AppRoleDefinition = {
  apiRole: ApiRole;
  appRole: string;
  description: string;
  scope: string;
};

export const APP_ROLE_DEFINITIONS: readonly AppRoleDefinition[] = [
  { apiRole: "OWNER", appRole: "Собственник", description: "Полный продуктовый и конфигурационный контур; медицинские сведения требуют отдельного допуска", scope: "Все филиалы" },
  { apiRole: "DIRECTOR", appRole: "Директор", description: "Управление операционными разделами назначенных площадок", scope: "Назначенные филиалы" },
  { apiRole: "ADMIN", appRole: "Администратор", description: "Карточки, учебный контур и текущие административные процессы", scope: "Назначенные филиалы" },
  { apiRole: "DEPUTY", appRole: "Завуч", description: "Учебный процесс, методики и расписание", scope: "Школа и назначенные классы" },
  { apiRole: "FINANCE", appRole: "Финансы", description: "Финансы, смежные операционные данные и аналитика", scope: "Разрешённые юрлица и филиалы" },
  { apiRole: "ACCOUNTING", appRole: "Бухгалтерия", description: "Бухгалтерский контур, реестр и связанные документы", scope: "Разрешённые юрлица" },
  { apiRole: "HR", appRole: "HR", description: "Персонал, кадровые документы и карточки сотрудников", scope: "Назначенные подразделения" },
  { apiRole: "SALES", appRole: "Продажи", description: "Продажи, семьи и клиентские карточки", scope: "Назначенные филиалы" },
  { apiRole: "MARKETING", appRole: "Маркетинг", description: "Контент, продажи и подтверждённые показатели", scope: "Назначенные проекты" },
  { apiRole: "TEACHER", appRole: "Педагог", description: "Учебный процесс и собственные задачи", scope: "Назначенные классы и группы" },
  { apiRole: "METHODIST", appRole: "Методист", description: "Методики, программы и учебный процесс", scope: "Назначенные программы" },
  { apiRole: "KITCHEN", appRole: "Кухня", description: "Питание и связанные рабочие задачи", scope: "Назначенные площадки" },
  { apiRole: "PROCUREMENT", appRole: "Закупки", description: "Закупки, подрядчики, имущество и документы", scope: "Назначенные площадки" },
  { apiRole: "SAFETY", appRole: "Безопасность", description: "Безопасность и связанные рабочие задачи", scope: "Назначенные объекты" },
  { apiRole: "MEDICAL", appRole: "Медработник", description: "Отдельный защищённый медицинский контур", scope: "Только активный специальный допуск" },
  { apiRole: "LEGAL", appRole: "Юрист", description: "Юридические документы, бухгалтерский контур и реестр", scope: "Назначенные организации" },
  { apiRole: "INTEGRATIONS", appRole: "Интеграции", description: "Подключения, обмен и техническая готовность без доступа к секретам владельца", scope: "Назначенные интеграции" },
  { apiRole: "ANALYTICS", appRole: "Аналитика", description: "Аналитика и чтение подтверждённых операционных показателей", scope: "Разрешённые наборы данных" },
  { apiRole: "PROJECTS", appRole: "Проекты", description: "Проекты, KPI и связанные задачи", scope: "Назначенные проекты" },
  { apiRole: "QUALITY", appRole: "Контроль качества", description: "Готовность, приёмка и контроль качества", scope: "Назначенные контуры" },
  { apiRole: "EMPLOYEE", appRole: "Сотрудник", description: "Личный рабочий контур, задачи и события", scope: "Только собственные данные" },
] as const;

export const API_ROLE_BY_APP_ROLE: Readonly<Record<string, ApiRole>> = Object.fromEntries(
  APP_ROLE_DEFINITIONS.map(({ appRole, apiRole }) => [appRole, apiRole]),
);

export const ASSIGNABLE_APP_ROLES = APP_ROLE_DEFINITIONS
  .filter(({ apiRole }) => apiRole !== "OWNER")
  .map(({ appRole }) => appRole);

export const SAFE_API_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type ApiRule = { prefix: string; read: readonly ApiRole[]; write: readonly ApiRole[] };

const withOwner = (...roles: Exclude<ApiRole, "OWNER">[]) => ["OWNER", ...roles] as const;
const allRoles = [...API_ROLES];

export const API_RULES: readonly ApiRule[] = ([
  // Every authenticated user may submit/view their own reports; the handler alone grants canonical-owner triage.
  { prefix: "/api/developer-feedback", read: allRoles, write: allRoles },
  { prefix: "/api/integrations/alfacrm", read: withOwner("DIRECTOR", "INTEGRATIONS", "FINANCE", "ACCOUNTING"), write: withOwner("DIRECTOR", "INTEGRATIONS") },
  { prefix: "/api/settings/backups", read: withOwner(), write: withOwner() },
  { prefix: "/api/dashboard-layout", read: allRoles, write: allRoles },
  { prefix: "/api/settings/temporary-credential", read: [], write: withOwner() },
  // Every signed-in user may save only their own navigation preferences. All
  // administrative actions in this route still call requireOwner server-side.
  { prefix: "/api/settings", read: allRoles, write: allRoles },
  { prefix: "/api/finance-actions", read: [], write: withOwner("DIRECTOR", "FINANCE") },
  { prefix: "/api/finance", read: withOwner("DIRECTOR", "FINANCE", "ACCOUNTING", "ANALYTICS"), write: [] },
  { prefix: "/api/accounting-actions", read: [], write: withOwner("DIRECTOR", "ACCOUNTING") },
  { prefix: "/api/accounting", read: withOwner("DIRECTOR", "ACCOUNTING", "FINANCE", "LEGAL"), write: [] },
  { prefix: "/api/sales-actions", read: [], write: withOwner("DIRECTOR", "SALES") },
  { prefix: "/api/sales", read: withOwner("DIRECTOR", "SALES", "MARKETING", "FINANCE", "ANALYTICS"), write: [] },
  { prefix: "/api/content-actions", read: [], write: withOwner("DIRECTOR", "MARKETING") },
  { prefix: "/api/content-generate", read: [], write: withOwner("DIRECTOR", "MARKETING") },
  { prefix: "/api/content", read: withOwner("DIRECTOR", "ADMIN", "MARKETING", "ANALYTICS"), write: [] },
  { prefix: "/api/education-actions", read: [], write: withOwner("DIRECTOR", "ADMIN", "DEPUTY", "METHODIST", "TEACHER") },
  { prefix: "/api/education", read: withOwner("DIRECTOR", "ADMIN", "DEPUTY", "METHODIST", "TEACHER"), write: [] },
  { prefix: "/api/hr-actions", read: [], write: withOwner("DIRECTOR", "HR") },
  { prefix: "/api/hr", read: withOwner("DIRECTOR", "HR"), write: [] },
  { prefix: "/api/legal-actions", read: [], write: withOwner("DIRECTOR", "LEGAL") },
  { prefix: "/api/legal", read: withOwner("DIRECTOR", "LEGAL"), write: [] },
  { prefix: "/api/medical-actions", read: [], write: ["MEDICAL"] },
  { prefix: "/api/medical", read: ["MEDICAL"], write: [] },
  { prefix: "/api/integration-actions", read: [], write: withOwner("DIRECTOR", "INTEGRATIONS") },
  { prefix: "/api/integrations", read: withOwner("DIRECTOR", "INTEGRATIONS", "FINANCE", "ACCOUNTING"), write: [] },
  { prefix: "/api/analytics-actions", read: [], write: withOwner("DIRECTOR", "ANALYTICS") },
  { prefix: "/api/analytics", read: withOwner("DIRECTOR", "ANALYTICS", "FINANCE"), write: [] },
  { prefix: "/api/procurement-actions", read: [], write: withOwner("DIRECTOR", "PROCUREMENT") },
  { prefix: "/api/procurement", read: withOwner("DIRECTOR", "PROCUREMENT", "FINANCE"), write: [] },
  { prefix: "/api/food-actions", read: [], write: withOwner("DIRECTOR", "KITCHEN") },
  { prefix: "/api/food", read: withOwner("DIRECTOR", "KITCHEN", "FINANCE"), write: [] },
  { prefix: "/api/safety-actions", read: [], write: withOwner("DIRECTOR", "SAFETY") },
  { prefix: "/api/safety", read: withOwner("DIRECTOR", "SAFETY", "FINANCE"), write: [] },
  { prefix: "/api/strategy-actions", read: [], write: withOwner("DIRECTOR", "PROJECTS") },
  { prefix: "/api/strategy", read: withOwner("DIRECTOR", "PROJECTS", "FINANCE"), write: [] },
  { prefix: "/api/readiness-actions", read: [], write: withOwner("DIRECTOR", "QUALITY") },
  { prefix: "/api/readiness", read: withOwner("DIRECTOR", "QUALITY", "ANALYTICS", "INTEGRATIONS"), write: [] },
  { prefix: "/api/acceptance", read: withOwner("DIRECTOR", "QUALITY"), write: withOwner() },
  { prefix: "/api/contractors", read: withOwner("DIRECTOR", "ADMIN", "PROCUREMENT", "FINANCE", "ACCOUNTING", "LEGAL"), write: [] },
  { prefix: "/api/families", read: withOwner("DIRECTOR", "ADMIN", "DEPUTY", "SALES"), write: withOwner("DIRECTOR", "ADMIN", "SALES") },
  { prefix: "/api/entity-detail", read: withOwner("DIRECTOR", "ADMIN", "SALES", "HR", "FINANCE", "ACCOUNTING", "LEGAL", "PROCUREMENT"), write: [] },
  { prefix: "/api/entity-relations", read: [], write: withOwner("DIRECTOR", "ADMIN") },
  { prefix: "/api/entity-documents", read: [], write: withOwner("DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "PROCUREMENT") },
  { prefix: "/api/entity-merge", read: [], write: withOwner("DIRECTOR", "ADMIN") },
  { prefix: "/api/entities", read: withOwner("DIRECTOR", "ADMIN", "SALES", "HR", "FINANCE", "ACCOUNTING", "LEGAL", "PROCUREMENT"), write: withOwner("DIRECTOR", "ADMIN") },
  { prefix: "/api/workflow-documents", read: withOwner("DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "FINANCE", "PROCUREMENT"), write: withOwner("DIRECTOR", "ADMIN", "HR", "LEGAL", "ACCOUNTING", "PROCUREMENT") },
  { prefix: "/api/audit", read: withOwner("DIRECTOR", "ADMIN", "QUALITY", "LEGAL"), write: [] },
  { prefix: "/api/data-mode", read: withOwner("DIRECTOR", "ANALYTICS", "QUALITY"), write: [] },
  { prefix: "/api/task-actions", read: allRoles, write: allRoles },
  { prefix: "/api/tasks", read: allRoles, write: allRoles },
  { prefix: "/api/work-items", read: allRoles, write: [] },
  { prefix: "/api/notifications", read: allRoles, write: allRoles },
] satisfies ApiRule[]).sort((left, right) => right.prefix.length - left.prefix.length);

/**
 * API paths owned by product sections. Explicit section assignment is enforced
 * here as well as in navigation. A manually added section can expand GET/HEAD
 * visibility, while mutations remain bounded by the selected role template.
 */
const API_MODULE_REQUIREMENTS: ReadonlyArray<{ prefix: string; modules: readonly ModuleId[] }> = ([
  { prefix: "/api/content-generate", modules: ["content"] },
  { prefix: "/api/content-actions", modules: ["content"] },
  { prefix: "/api/accounting-actions", modules: ["accounting"] },
  { prefix: "/api/integration-actions", modules: ["integrations"] },
  { prefix: "/api/education-actions", modules: ["education", "methods"] },
  { prefix: "/api/procurement-actions", modules: ["procurement", "assets"] },
  { prefix: "/api/readiness-actions", modules: ["quality", "acceptance"] },
  { prefix: "/api/finance-actions", modules: ["finance"] },
  { prefix: "/api/sales-actions", modules: ["sales"] },
  { prefix: "/api/hr-actions", modules: ["hr"] },
  { prefix: "/api/legal-actions", modules: ["legal"] },
  { prefix: "/api/medical-actions", modules: ["medical"] },
  { prefix: "/api/analytics-actions", modules: ["analytics"] },
  { prefix: "/api/food-actions", modules: ["food"] },
  { prefix: "/api/safety-actions", modules: ["safety"] },
  { prefix: "/api/strategy-actions", modules: ["projects"] },
  { prefix: "/api/entity-relations", modules: ["registry", "clients"] },
  { prefix: "/api/entity-documents", modules: ["registry", "clients", "hr", "legal", "accounting", "procurement"] },
  { prefix: "/api/entity-detail", modules: ["registry", "clients"] },
  { prefix: "/api/entity-merge", modules: ["registry"] },
  { prefix: "/api/workflow-documents", modules: ["legal", "accounting", "hr", "procurement"] },
  { prefix: "/api/integrations", modules: ["integrations"] },
  { prefix: "/api/accounting", modules: ["accounting"] },
  { prefix: "/api/education", modules: ["education", "methods"] },
  { prefix: "/api/procurement", modules: ["procurement", "assets"] },
  { prefix: "/api/readiness", modules: ["quality", "acceptance"] },
  { prefix: "/api/acceptance", modules: ["acceptance"] },
  { prefix: "/api/contractors", modules: ["contractors"] },
  { prefix: "/api/families", modules: ["clients"] },
  { prefix: "/api/entities", modules: ["registry", "clients"] },
  { prefix: "/api/finance", modules: ["finance"] },
  { prefix: "/api/sales", modules: ["sales"] },
  { prefix: "/api/content", modules: ["content"] },
  { prefix: "/api/medical", modules: ["medical"] },
  { prefix: "/api/analytics", modules: ["analytics"] },
  { prefix: "/api/food", modules: ["food"] },
  { prefix: "/api/safety", modules: ["safety"] },
  { prefix: "/api/strategy", modules: ["projects"] },
  { prefix: "/api/hr", modules: ["hr"] },
  { prefix: "/api/legal", modules: ["legal"] },
  { prefix: "/api/task-actions", modules: ["tasks", "events"] },
  { prefix: "/api/work-items", modules: ["tasks", "events"] },
  { prefix: "/api/notifications", modules: ["tasks", "events"] },
  { prefix: "/api/tasks", modules: ["tasks", "events"] },
  { prefix: "/api/audit", modules: ["quality"] },
] satisfies Array<{ prefix: string; modules: readonly ModuleId[] }>).sort((left, right) => right.prefix.length - left.prefix.length);

const MODULE_API_REQUIREMENTS: Record<ModuleId, readonly string[]> = {
  home: [], tasks: ["/api/tasks"], finance: ["/api/finance"], accounting: ["/api/accounting"],
  registry: ["/api/entities", "/api/entity-detail"], sales: ["/api/sales"], clients: ["/api/entities", "/api/families"],
  education: ["/api/education"], methods: ["/api/education"], hr: ["/api/hr"], legal: ["/api/legal"],
  procurement: ["/api/procurement"], food: ["/api/food"], safety: ["/api/safety"], medical: ["/api/medical"],
  content: ["/api/content"], events: ["/api/tasks"], projects: ["/api/strategy"], analytics: ["/api/analytics"],
  contractors: ["/api/contractors"], assets: ["/api/procurement"], quality: ["/api/readiness"],
  access: ["/api/settings#write"], integrations: ["/api/integrations"], acceptance: ["/api/readiness", "/api/acceptance"],
};

const MODULE_WRITE_ENDPOINT: Partial<Record<ModuleId, string>> = {
  tasks: "/api/tasks", finance: "/api/finance-actions", accounting: "/api/accounting-actions", sales: "/api/sales-actions",
  clients: "/api/families", education: "/api/education-actions", methods: "/api/education-actions", hr: "/api/hr-actions",
  legal: "/api/legal-actions", procurement: "/api/procurement-actions", food: "/api/food-actions", safety: "/api/safety-actions",
  medical: "/api/medical-actions", content: "/api/content-actions", events: "/api/tasks", projects: "/api/strategy-actions",
  analytics: "/api/analytics-actions", assets: "/api/procurement-actions", quality: "/api/readiness-actions", access: "/api/settings",
  integrations: "/api/integration-actions", acceptance: "/api/readiness-actions",
};

export type RegistryAction = "create" | "edit" | "relation" | "document" | "merge";
export type RegistryCapabilities = Readonly<Record<RegistryAction, boolean>>;
export type RolePermission = "Управление" | "Редактирование" | "Просмотр" | "Нет доступа" | "Особый доступ";

const knownApiRoles = new Set<string>(API_ROLES);

export function isKnownApiRole(role: string): role is ApiRole {
  return knownApiRoles.has(role);
}

export function canAccessApi(context: AccessPolicyContext, pathname: string, method: string) {
  if (!isKnownApiRole(context.apiRole)) return false;
  const assignedModules = context.allowedModules === undefined ? null : new Set(context.allowedModules);
  const moduleRequirement = API_MODULE_REQUIREMENTS.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  const sectionAssigned = !moduleRequirement || assignedModules === null
    ? true
    : moduleRequirement.modules.some((moduleId) => assignedModules.has(moduleId));
  const medicalRoute = pathname === "/api/medical"
    || pathname.startsWith("/api/medical/")
    || pathname === "/api/medical-actions"
    || pathname.startsWith("/api/medical-actions/");
  if (medicalRoute) return sectionAssigned && context.apiRole === "MEDICAL" && context.canAccessMedical === true;
  if (!sectionAssigned) return false;
  if (context.apiRole === "OWNER") return context.isSystemOwner;
  const rule = API_RULES.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  if (!rule) return false;
  const safeRead = SAFE_API_METHODS.has(method.toUpperCase());
  const allowed = safeRead ? rule.read : rule.write;
  const roleAllows = allowed.includes(context.apiRole);
  // A manually checked section may expose its read model. It never grants a
  // mutation that the user's role does not already authorize.
  return roleAllows || Boolean(safeRead && moduleRequirement && assignedModules);
}

export function canAccessModule(context: AccessPolicyContext, moduleId: ModuleId) {
  if (moduleId === "home") return true;
  if (context.allowedModules !== undefined && !context.allowedModules.includes(moduleId)) return false;
  // The settings endpoint also accepts a narrowly scoped self-service favorites
  // mutation. That must never make the access-management screen available to a
  // non-owner role.
  if (moduleId === "access") return canManageAccess(context);
  return MODULE_API_REQUIREMENTS[moduleId].every((requirement) => {
    const write = requirement.endsWith("#write");
    return canAccessApi(context, write ? requirement.slice(0, -6) : requirement, write ? "POST" : "GET");
  });
}

export function accessibleModules(context: AccessPolicyContext, modules: readonly ModuleId[]) {
  return modules.filter((moduleId) => canAccessModule(context, moduleId));
}

export function resolveModuleRoute(context: AccessPolicyContext, requested: string, knownModules: readonly ModuleId[]): ModuleId {
  const matched = knownModules.find((moduleId) => moduleId === requested);
  return matched && canAccessModule(context, matched) ? matched : "home";
}

export function registryCapabilities(context: AccessPolicyContext): RegistryCapabilities {
  return {
    create: canAccessApi(context, "/api/entities", "POST"),
    edit: canAccessApi(context, "/api/entities", "PATCH"),
    relation: canAccessApi(context, "/api/entity-relations", "POST"),
    document: canAccessApi(context, "/api/entity-documents", "POST"),
    merge: canAccessApi(context, "/api/entity-merge", "POST"),
  };
}

export function canManageAccess(context: AccessPolicyContext) {
  return context.apiRole === "OWNER" && context.isSystemOwner;
}

export function permissionForRole(apiRole: ApiRole, moduleId: ModuleId): RolePermission {
  const context: AccessPolicyContext = { apiRole, isSystemOwner: apiRole === "OWNER", canAccessMedical: apiRole === "MEDICAL" };
  if (!canAccessModule(context, moduleId)) return "Нет доступа";
  if (moduleId === "medical") return "Особый доступ";
  if (apiRole === "OWNER") return "Управление";
  if (moduleId === "registry") return Object.values(registryCapabilities(context)).some(Boolean) ? "Редактирование" : "Просмотр";
  const writeEndpoint = MODULE_WRITE_ENDPOINT[moduleId];
  return writeEndpoint && canAccessApi(context, writeEndpoint, "POST") ? "Редактирование" : "Просмотр";
}
