import { NextResponse } from "next/server";
import { arthelloOrigin } from "../../../../server/central-sso";

export function GET() {
  return NextResponse.redirect(arthelloOrigin(), 302);
}
