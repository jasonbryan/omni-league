/// <reference types="vite/client" />
// The docs' "./**/!(*.*.*)*.*s" pattern matches nothing on Vite 8.
export const modules = import.meta.glob(['./**/*.{js,ts}', '!./**/*.*.{js,ts}']);
