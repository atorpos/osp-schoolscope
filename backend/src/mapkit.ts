import { readFileSync } from 'node:fs';
import express from 'express';
import { importPKCS8, SignJWT } from 'jose';
import { asyncRoute } from './http.js';

/**
 * Apple MapKit JS needs a JWT signed with a MapKit key from the Apple Developer account
 * (Certificates, Identifiers & Profiles → Keys, with MapKit JS / Maps enabled):
 *
 *   MAPKIT_TEAM_ID       the 10-character Team ID
 *   MAPKIT_KEY_ID        the key's 10-character Key ID
 *   MAPKIT_PRIVATE_KEY   the .p8 file's contents (newlines may be written as \n), or
 *   MAPKIT_PRIVATE_KEY_FILE, a path to the .p8 file
 *   MAPKIT_ORIGIN        optional: the site's origin, e.g. https://schoolscope.example.com, so a copied token
 *                        only works there
 *
 * The key never leaves the server; the browser asks `GET /api/mapkit/token` for a short-lived token.
 */
export interface MapKitConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  origin: string | null;
}

/** Token lifetime. MapKit JS asks for a new one (authorizationCallback) when it runs out. */
export const MAPKIT_TOKEN_TTL = 30 * 60;

export function mapKitConfig(env: NodeJS.ProcessEnv = process.env): MapKitConfig | null {
  const teamId = env.MAPKIT_TEAM_ID?.trim() || '';
  const keyId = env.MAPKIT_KEY_ID?.trim() || '';
  let privateKey = env.MAPKIT_PRIVATE_KEY?.replace(/\\n/g, '\n').trim() || '';
  if (!privateKey && env.MAPKIT_PRIVATE_KEY_FILE) privateKey = readFileSync(env.MAPKIT_PRIVATE_KEY_FILE, 'utf8').trim();
  const given = [teamId, keyId, privateKey].filter(Boolean).length;
  if (given === 0) return null;
  if (given < 3) {
    throw new Error('Apple Maps needs MAPKIT_TEAM_ID, MAPKIT_KEY_ID and MAPKIT_PRIVATE_KEY (or MAPKIT_PRIVATE_KEY_FILE) together');
  }
  return { teamId, keyId, privateKey, origin: env.MAPKIT_ORIGIN?.trim() || null };
}

/** Returns a function that signs MapKit JS tokens. Throws when the private key can't be read. */
export async function mapKitTokenSigner(config: MapKitConfig): Promise<() => Promise<{ token: string; expiresAt: string }>> {
  const key = await importPKCS8(config.privateKey, 'ES256');
  return async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT(config.origin ? { origin: config.origin } : {})
      .setProtectedHeader({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })
      .setIssuer(config.teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + MAPKIT_TOKEN_TTL)
      .sign(key);
    return { token, expiresAt: new Date((now + MAPKIT_TOKEN_TTL) * 1000).toISOString() };
  };
}

/** `GET /api/mapkit/token`: a MapKit JS token, or 503 when Apple Maps isn't set up (the web app then draws its own map) */
export function mapKitRouter(env: NodeJS.ProcessEnv = process.env): express.Router {
  let problem = 'Apple Maps is not configured on this server.';
  const signer = (async () => {
    try {
      const config = mapKitConfig(env);
      if (!config) return null;
      const sign = await mapKitTokenSigner(config);
      console.info(`Apple Maps ready (team ${config.teamId}, key ${config.keyId}${config.origin ? `, origin ${config.origin}` : ''})`);
      return sign;
    } catch (error) {
      // A bad key turns the map off rather than stopping the API
      problem = 'Apple Maps is misconfigured on this server.';
      console.error(`Apple Maps disabled: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  })();

  const router = express.Router();
  router.get('/token', asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const sign = await signer;
    if (!sign) return void res.status(503).json({ error: problem, configured: false });
    res.json({ ...(await sign()), configured: true });
  }));
  return router;
}
