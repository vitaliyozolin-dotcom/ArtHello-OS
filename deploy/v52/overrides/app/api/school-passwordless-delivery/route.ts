import { processSchoolPasswordlessDelivery } from "../../../lib/school-passwordless-delivery";

export const dynamic = "force-dynamic";

function statusFor(message: string) {
  if (message.includes("signature") || message.includes("expired")) return 401;
  if (message.includes("not configured")) return 503;
  return 400;
}

export async function POST(request: Request) {
  try {
    const result = await processSchoolPasswordlessDelivery(request);
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "School delivery failed";
    return Response.json(
      { error: message },
      {
        status: statusFor(message),
        headers: { "cache-control": "no-store" },
      },
    );
  }
}