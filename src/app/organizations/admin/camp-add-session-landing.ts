import { Injectable } from '@angular/core';
import { FragmentLanding } from '../../core/fragment-landing';

export const ADD_SESSION_FRAGMENT = 'add-session';
const CAMP_PATH = /^\/app\/organizations\/[^/]+\/camps\/[^/]+$/;

/** Provided by the camp page, which renders the form only once `getForManagement` answers. */
@Injectable()
export class CampAddSessionLanding extends FragmentLanding {
  constructor() {
    super({
      atLoad: (snapshot) => snapshot.fragment === ADD_SESSION_FRAGMENT,
      atArrival: (path, fragment) => CAMP_PATH.test(path) && fragment === ADD_SESSION_FRAGMENT,
    });
  }
}
