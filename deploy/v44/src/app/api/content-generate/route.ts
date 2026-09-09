import { env } from "cloudflare:workers";
import { getRequestUser } from "../../../lib/request-user";

const allowedRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "MARKETING"]);

export async function POST(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!allowedRoles.has(role)) return Response.json({ error: "Нет прав на генерацию контента" }, { status: 403 });
  const apiKey = (env as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({
      error: "OpenAI Images не подключён. Добавьте OPENAI_API_KEY в защищённые переменные staging-стенда.",
      needsCredential: true,
    }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const prompt = String(form.get("prompt") ?? "").trim().slice(0, 4000);
    const size = new Set(["1024x1024", "1536x1024", "1024x1536"]).has(String(form.get("size")))
      ? String(form.get("size"))
      : "1024x1024";
    const quality = new Set(["low", "medium", "high"]).has(String(form.get("quality")))
      ? String(form.get("quality"))
      : "medium";
    const reference = form.get("reference");
    if (prompt.length < 12) return Response.json({ error: "Опишите изображение подробнее — минимум 12 символов" }, { status: 400 });
    if (reference instanceof File && reference.size > 8 * 1024 * 1024) {
      return Response.json({ error: "Референс должен быть не больше 8 МБ" }, { status: 400 });
    }

    let response: Response;
    if (reference instanceof File && reference.size > 0) {
      if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(reference.type)) {
        return Response.json({ error: "Поддерживаются PNG, JPEG и WebP" }, { status: 400 });
      }
      const body = new FormData();
      body.set("model", "gpt-image-1");
      body.set("prompt", prompt);
      body.set("size", size);
      body.set("quality", quality);
      body.set("image", reference);
      response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body,
      });
    } else {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1", prompt, size, quality, output_format: "png" }),
      });
    }
    const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!response.ok || !payload.data?.[0]?.b64_json) {
      return Response.json({ error: payload.error?.message ?? "Изображение не создано" }, { status: response.status || 502 });
    }
    return Response.json({
      imageDataUrl: `data:image/png;base64,${payload.data[0].b64_json}`,
      model: "gpt-image-1",
      stored: false,
    });
  } catch (error) {
    console.error("content.image_generation_failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Не удалось создать изображение" }, { status: 502 });
  }
}
