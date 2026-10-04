import { NextResponse } from "next/server";
import { arthelloOrigin } from "../../../../server/central-sso";
import { centralManagementUrl } from "../../../../lib/central-management.mjs";

export function GET(request: Request) {
  return NextResponse.redirect(centralManagementUrl(arthelloOrigin(), new URL(request.url).searchParams.get("section")), 302);
}
