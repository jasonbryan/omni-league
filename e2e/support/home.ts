import type { Page } from '@playwright/test';

/** The `<h1>` of `/app` carries the user's first name, so a spec matches only its start. */
export const HOME_HEADING = /^Hi\b/;

export const homeHeading = (page: Page) =>
  page.getByRole('heading', { level: 1, name: HOME_HEADING });
