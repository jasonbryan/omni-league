import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { provideConvexServerQueries } from './core/data/convex/server-query-loader';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes)), provideConvexServerQueries()],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
