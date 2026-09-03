type ExpectedSettingsStatus = 400 | 403 | 404 | 409;

const EXPECTED_SETTINGS_ACTION_ERRORS = new Map<string, ExpectedSettingsStatus>([
  ["Выберите филиал", 400],
  ["Нет прав на выбранный филиал", 403],
  ["Нет прав: изменять доступы и системные настройки может только собственник", 403],
  ["Семья не найдена в центральном реестре", 404],
  ["Права уже изменены в другом окне. Обновите данные и повторите действие", 409],
]);

export function safeSettingsActionError(error: unknown) {
  const candidate = error instanceof Error ? error.message : "";
  const expectedStatus = EXPECTED_SETTINGS_ACTION_ERRORS.get(candidate);
  if (expectedStatus) {
    return { message: candidate, status: expectedStatus, expected: true as const };
  }
  return {
    message: "Действие временно не выполнено",
    status: 500 as const,
    expected: false as const,
  };
}
