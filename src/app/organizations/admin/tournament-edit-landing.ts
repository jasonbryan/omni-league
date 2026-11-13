import { Injectable } from '@angular/core';
import { FragmentLanding } from '../../core/fragment-landing';

export const EDIT_DETAILS_FRAGMENT = 'edit-details';
const TOURNAMENT_PATH = /^\/app\/organizations\/[^/]+\/tournaments\/[^/]+$/;

/** Provided by the tournament page, which renders the form only once `getForManagement` answers. */
@Injectable()
export class TournamentEditLanding extends FragmentLanding {
  constructor() {
    super({
      atLoad: (snapshot) => snapshot.fragment === EDIT_DETAILS_FRAGMENT,
      atArrival: (path, fragment) =>
        TOURNAMENT_PATH.test(path) && fragment === EDIT_DETAILS_FRAGMENT,
    });
  }
}
