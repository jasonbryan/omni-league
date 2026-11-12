import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP = join(process.cwd(), 'src', 'app');
const UI = join(APP, 'ui') + sep;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

export const OUTSIDE_UI = sources(APP).filter((path) => !path.startsWith(UI));

export const appPath = (path: string) => relative(APP, path);

export const readSource = (path: string) => readFileSync(path, 'utf8');

export const offenders = (pattern: RegExp | string) =>
  OUTSIDE_UI.filter((path) => {
    const source = readSource(path);
    return typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
  }).map(appPath);
