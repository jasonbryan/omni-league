import { publicTrainingPath } from '../public-training/public-training-path';

/** Built from the slugs, never copied from the current URL, which can carry other parameters or a fragment. */
export function registerTrainingPath(
  orgSlug: string,
  trainingSlug: string,
  classId?: string,
): string {
  const path = `/app${publicTrainingPath(orgSlug, trainingSlug)}/register`;
  return classId === undefined ? path : `${path}?${CLASS_QUERY}=${encodeURIComponent(classId)}`;
}

export const CLASS_QUERY = 'class';
