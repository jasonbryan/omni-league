import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';

const http = httpRouter();

// Better Auth's routes under /api/auth/* on the deployment's .convex.site URL (ADR 0008). CORS
// allows the trusted origins only (convex/lib/authOrigins.ts), with credentials.
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
