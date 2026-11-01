import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';

const http = httpRouter();

// CORS allows the trusted origins only (`convex/lib/authOrigins.ts`).
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
