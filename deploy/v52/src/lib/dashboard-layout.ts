export const DASHBOARD_LAYOUT_VERSION = 1 as const;

export const DASHBOARD_WIDGET_IDS = [
  "kpis",
  "cashflow",
  "decisions",
  "signals",
  "milestones",
  "roleFocus",
  "operations",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export type DashboardWidgetSize = "compact" | "wide" | "full";
export type DashboardDropPosition = "before" | "after";
export type DashboardWidgetPreference = {
  id: DashboardWidgetId;
  visible: boolean;
  size: DashboardWidgetSize;
};
export type DashboardLayoutPayload = {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  widgets: DashboardWidgetPreference[];
};

export type DashboardLayoutValidation =
  | { ok: true; layout: DashboardLayoutPayload }
  | { ok: false; error: string };

export type DashboardBrowserStorage = {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

export const DASHBOARD_BROWSER_STORAGE_PREFIX = `arthello:dashboard-layout:v${DASHBOARD_LAYOUT_VERSION}`;

const OWNER_ROLES = new Set(["Собственник", "Представитель Виталия"]);
const FINANCE_ROLES = new Set(["Финансы", "Бухгалтерия"]);
const ALL_WIDGETS = new Set<DashboardWidgetId>(DASHBOARD_WIDGET_IDS);
const DIRECTOR_WIDGETS = new Set<DashboardWidgetId>(DASHBOARD_WIDGET_IDS.filter((id) => id !== "operations"));
const FINANCE_WIDGETS = new Set<DashboardWidgetId>(DASHBOARD_WIDGET_IDS.filter((id) => id !== "signals"));
const WORK_WIDGETS = new Set<DashboardWidgetId>(["kpis", "roleFocus", "decisions", "milestones"]);
const VALID_SIZES = new Set<DashboardWidgetSize>(["compact", "wide", "full"]);

export function allowedDashboardWidgetIds(appRole: string): ReadonlySet<DashboardWidgetId> {
  if (OWNER_ROLES.has(appRole)) return ALL_WIDGETS;
  if (appRole === "Директор") return DIRECTOR_WIDGETS;
  if (FINANCE_ROLES.has(appRole)) return FINANCE_WIDGETS;
  return WORK_WIDGETS;
}

export function validateDashboardLayout(value: unknown, appRole: string): DashboardLayoutValidation {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "widgets"])) {
    return { ok: false, error: "Некорректный формат настройки экрана" };
  }
  if (value.version !== DASHBOARD_LAYOUT_VERSION || !Array.isArray(value.widgets)) {
    return { ok: false, error: "Неподдерживаемая версия настройки экрана" };
  }

  const allowed = allowedDashboardWidgetIds(appRole);
  if (value.widgets.length !== allowed.size) {
    return { ok: false, error: "Настройка должна содержать все доступные блоки роли" };
  }

  const seen = new Set<DashboardWidgetId>();
  const widgets: DashboardWidgetPreference[] = [];
  for (const item of value.widgets) {
    if (!isRecord(item) || !hasOnlyKeys(item, ["id", "visible", "size"])) {
      return { ok: false, error: "Некорректное описание блока" };
    }
    if (typeof item.id !== "string" || !isWidgetId(item.id) || !allowed.has(item.id) || seen.has(item.id)) {
      return { ok: false, error: "Недоступный или повторяющийся блок" };
    }
    if (typeof item.visible !== "boolean" || typeof item.size !== "string" || !isWidgetSize(item.size)) {
      return { ok: false, error: "Некорректные видимость или размер блока" };
    }
    seen.add(item.id);
    widgets.push({ id: item.id, visible: item.visible, size: item.size });
  }

  return { ok: true, layout: { version: DASHBOARD_LAYOUT_VERSION, widgets } };
}

export function dashboardLayoutStateKey(appUserId: string, appRole: string) {
  return `dashboard-layout:v${DASHBOARD_LAYOUT_VERSION}:${encodeURIComponent(appUserId)}:${encodeURIComponent(appRole)}`;
}

export function dashboardBrowserStorageKey(
  appUserId: string,
  appRole: string,
  prefix = DASHBOARD_BROWSER_STORAGE_PREFIX,
) {
  return `${prefix}:id=${encodeURIComponent(appUserId)}:role=${encodeURIComponent(appRole)}`;
}

export function dashboardFallbackStorageKey(displayName: string, appRole: string) {
  return `${DASHBOARD_BROWSER_STORAGE_PREFIX}:display=${encodeURIComponent(displayName)}:role=${encodeURIComponent(appRole)}`;
}

export function clearDashboardBrowserLayouts(storage: DashboardBrowserStorage, appUserId: string) {
  const userPrefix = `${DASHBOARD_BROWSER_STORAGE_PREFIX}:id=${encodeURIComponent(appUserId)}:role=`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(userPrefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function reorderDashboardWidgets(
  widgets: DashboardWidgetPreference[],
  activeId: string,
  targetId: string,
  position: DashboardDropPosition,
) {
  const activeIndex = widgets.findIndex((widget) => widget.id === activeId);
  const targetIndex = widgets.findIndex((widget) => widget.id === targetId);
  if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return widgets;

  const next = [...widgets];
  const moved = next.splice(activeIndex, 1)[0];
  if (!moved) return widgets;
  const remainingTargetIndex = next.findIndex((widget) => widget.id === targetId);
  const insertionIndex = position === "after" ? remainingTargetIndex + 1 : remainingTargetIndex;
  next.splice(insertionIndex, 0, moved);
  return next;
}

function isWidgetId(value: string): value is DashboardWidgetId {
  return (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function isWidgetSize(value: string): value is DashboardWidgetSize {
  return VALID_SIZES.has(value as DashboardWidgetSize);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
