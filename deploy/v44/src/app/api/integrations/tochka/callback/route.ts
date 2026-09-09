import { env } from "cloudflare:workers";

function page(title: string, text: string, status = 200) {
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f5;color:#111;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(560px,calc(100vw - 40px));border:1px solid #deded9;border-top:4px solid #e23d33;padding:28px;background:#fff}h1{margin:0 0 10px;font-size:28px}p{margin:0;color:#666}a{display:inline-block;margin-top:20px;color:#c9332b}</style><main class="card"><h1>${title}</h1><p>${text}</p><a href="/#integrations">Вернуться в ArtHello OS</a></main></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) return page("Точка не выдала доступ", "Авторизация отменена или отклонена. Подключение не изменено.", 400);
  if (!url.searchParams.get("code")) return page("Callback Точки готов", "Этот постоянный HTTPS-адрес можно указать как Redirect URL приложения Точки.");
  const runtime = env as unknown as Record<string, unknown>;
  if (!runtime.TOCHKA_CLIENT_ID || !runtime.TOCHKA_CLIENT_SECRET) {
    return page("Код получен, секрет ещё не настроен", "Redirect URL работает, но обмен кода на токен заблокирован до установки защищённых переменных TOCHKA_CLIENT_ID и TOCHKA_CLIENT_SECRET.", 503);
  }
  return page("Авторизация принята", "Код получен. Адаптер обмена токена будет активирован после завершения настройки банковского подключения.");
}
