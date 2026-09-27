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
// provider. `expectedAudience` should be this resource's own identifier
// (origin + /api/mcp) - Authelia's claude-mcp client is restricted (via its
// `audience` whitelist) to only request that resource per RFC 8707, so a
// token's `aud` claim should always equal it. Checking this here is what
// stops a token issued for some *other* future OIDC client/resource on this
// same Authelia instance from being replayed against this endpoint.
export async function verifyMcpToken(
  authHeader: string | null,
  expectedAudience: string,
): Promise<JWTPayload | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const keys = await getJwks();
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: expectedAudience,
      clockTolerance: 5,
    });
    return payload;
  } catch (error) {
    console.error("MCP bearer token verification failed:", error);
    return null;
  }
}
