import { publicTrainingPath } from '../public-training/public-training-path';

/** Built from the slugs, never copied from the current URL, which can carry other parameters or a fragment. */
export function registerTrainingPath(orgSlug: string, trainingSlug: string): string {
  return `/app${publicTrainingPath(orgSlug, trainingSlug)}/register`;
}
