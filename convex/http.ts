import { getIp } from 'better-auth/api';
import { httpRouter } from 'convex/server';
import { env } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';

const PROBED_PATHS = new Set(['/api/auth/sign-in/email', '/api/auth/sign-up/email']);
const PROBE_VALUE_MAX = 100;

// Temporary, previews only: the answer carries what the per-IP limiter would key on, so reading it
// needs no access to the deployment's logs.
function withIpProbe(create: typeof createAuth): typeof createAuth {
  return (ctx) => {
    const auth = create(ctx);
    if (env.PREVIEW_ORIGIN_PATTERN !== PREVIEW_ORIGIN_PATTERN) return auth;
    const handler = async (request: Request): Promise<Response> => {
      const response = await auth.handler(request);
      if (!PROBED_PATHS.has(new URL(request.url).pathname)) return response;
      const header = request.headers.get('cf-connecting-ip')?.slice(0, PROBE_VALUE_MAX) ?? 'none';
      const resolved = getIp(request, auth.options) ?? 'none';
      const probed = new Response(response.body, response);
      probed.headers.set('x-ip-probe', `cf-connecting-ip=${header}; better-auth-ip=${resolved}`);
      return probed;
    };
    return { ...auth, handler };
  };
}

const http = httpRouter();

// CORS allows the trusted origins only (`convex/lib/authOrigins.ts`).
authComponent.registerRoutes(http, withIpProbe(createAuth), { cors: true });

export default http;
