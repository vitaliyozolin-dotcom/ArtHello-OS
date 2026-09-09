export async function readJsonResponse<T>(response: Response): Promise<T> {
  const statusSuffix = Number.isInteger(response.status) && response.status > 0
    ? ` (код ${response.status})`
    : "";
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw new Error(`Сервис временно не ответил${statusSuffix}. Повторите действие.`);
  }
  if (!text.trim()) {
    throw new Error(`Сервис временно не ответил${statusSuffix}. Повторите действие.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Сервис вернул некорректный ответ${statusSuffix}. Обновите страницу и повторите.`);
  }
}
