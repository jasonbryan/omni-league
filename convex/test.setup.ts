/// <reference types="vite/client" />
// Every Convex module except multi-dot files (*.d.ts, *.test.ts, test.setup.ts).
// Do not use the docs' "./**/!(*.*.*)*.*s" pattern: it matches nothing on Vite 8 (ADR 0004).
export const modules = import.meta.glob(['./**/*.{js,ts}', '!./**/*.*.{js,ts}']);
