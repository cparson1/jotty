import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

const issuer = (process.env.MCP_OIDC_ISSUER || "https://auth.parcelisk.net").replace(/\/$/, "");

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function getJwks() {
  if (jwks) return jwks;
  const discoveryRes = await fetch(`${issuer}/.well-known/openid-configuration`, {
    cache: "no-store",
  });
  if (!discoveryRes.ok) {
    throw new Error(`OIDC discovery failed: ${discoveryRes.status}`);
  }
  const discovery = (await discoveryRes.json()) as { jwks_uri: string };
  jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  return jwks;
}

// Verifies the MCP connector's OAuth bearer token against Authelia's OIDC
// provider. Deliberately doesn't check `aud` - Authelia's audience claim for
// a plain (non resource-indicator) authorization_code grant is the client_id,
// but this may vary, and a valid signature from our own Authelia instance is
// the real trust boundary for this single-user, personal deployment.
export async function verifyMcpToken(
  authHeader: string | null,
): Promise<JWTPayload | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const keys = await getJwks();
    const { payload } = await jwtVerify(token, keys, { issuer, clockTolerance: 5 });
    return payload;
  } catch (error) {
    console.error("MCP bearer token verification failed:", error);
    return null;
  }
}
