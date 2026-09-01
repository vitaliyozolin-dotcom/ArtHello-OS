import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  schoolDeployReadOnlyHeaders,
  schoolDeployReadOnlyPayload,
  schoolDeployReadOnlyState,
} from "./lib/maintenance-gate.mjs";

const HEALTH_PATH = "/api/health";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === HEALTH_PATH) return NextResponse.next();
  if (!schoolDeployReadOnlyState().active) return NextResponse.next();

  return NextResponse.json(schoolDeployReadOnlyPayload(), {
    status: 503,
    headers: schoolDeployReadOnlyHeaders(),
  });
}

export const config = {
  matcher: ["/api/:path*", "/auth/central/:path*"],
};
