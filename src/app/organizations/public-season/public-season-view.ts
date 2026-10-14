import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';

export type PublicSeasonData = NonNullable<FunctionReturnType<typeof api.seasons.getPublicPage>>;

export interface PublicSeasonView {
  season: PublicSeasonData;
}
