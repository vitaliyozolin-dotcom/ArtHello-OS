export type BackupContext = { auth: { user: { mustChangePassword?: boolean } } };
export type BackupDependencies<T extends BackupContext> = {
  authenticate: (request: Request) => Promise<T | null>;
  isOwner: (context: T) => boolean;
  verifyCsrf: (request: Request, context: T) => void;
  trustedOrigin: (request: Request) => boolean;
  transport?: { fetch: (request: Request) => Promise<Response> };
};

export async function handleBackupRequest<T extends BackupContext>(request: Request, dependencies: BackupDependencies<T>) {
  const json = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "private, no-store" } });
  if (!["GET", "POST"].includes(request.method)) return json(405, "Метод не поддерживается");
  let context: T | null;
  try { context = await dependencies.authenticate(request); }
  catch { return json(503, "Сервис авторизации временно недоступен"); }
  if (!context) return json(401, "Требуется вход");
  if (context.auth.user.mustChangePassword || !dependencies.isOwner(context)) return json(403, "Резервные копии доступны только собственнику");
  if (request.method === "POST") {
    if (!dependencies.trustedOrigin(request)) return json(403, "Источник страницы не совпадает");
    try { dependencies.verifyCsrf(request, context); }
    catch { return json(403, "Обновите страницу и повторите действие"); }
    // The command has no arguments: no filesystem path, unit, shell or restore action.
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return json(415, "Ожидается JSON");
    try {
      const reader = request.body?.getReader();
      let text = "";
      let bytes = 0;
      if (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 128) { await reader.cancel(); return json(413, "Запрос слишком большой"); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      }
      const body = JSON.parse(text);
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || body.action !== "create") return json(400, "Неизвестное действие");
    } catch { return json(400, "Некорректный запрос"); }
  }
  if (!dependencies.transport) return json(503, "Резервное копирование ещё не подключено к серверу");
  try {
    const result = await dependencies.transport.fetch(new Request(`http://backup.internal/${request.method === "POST" ? "create" : "status"}`, { method: request.method }));
    if (![200, 202, 409, 503].includes(result.status)) return json(503, "Сервис резервных копий временно недоступен");
    return new Response(result.body, { status: result.status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch { return json(503, "Сервис резервных копий временно недоступен"); }
}
