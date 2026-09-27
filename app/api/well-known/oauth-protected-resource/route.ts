import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Served at /.well-known/oauth-protected-resource via the rewrite in
// next.config.mjs (Next.js app-router route segments can't start with a
// dot). RFC 9728 protected resource metadata for /api/mcp.
export async function GET(request: NextRequest) {
  const origin = process.env.APP_URL || request.nextUrl.origin;
  const issuer = (process.env.MCP_OIDC_ISSUER || "https://auth.parcelisk.net").replace(/\/$/, "");

  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [issuer],
  });
}
