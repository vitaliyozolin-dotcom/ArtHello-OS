const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

export async function GET() {
  return Response.json(
    {
      error: "Маршрут авторизации Точки отключён. Используйте подключение готового ключа в настройках интеграции.",
    },
    { status: 410, headers: privateHeaders },
  );
}
