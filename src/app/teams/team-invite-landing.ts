import { Injectable } from '@angular/core';
import { FragmentLanding } from '../core/fragment-landing';

export const INVITE_FRAGMENT = 'invite';
const TEAM_PATH = /^\/app\/teams\/[^/]+$/;

@Injectable()
export class TeamInviteLanding extends FragmentLanding {
  constructor() {
    super({
      atLoad: (snapshot) => snapshot.fragment === INVITE_FRAGMENT,
      atArrival: (path, fragment) => TEAM_PATH.test(path) && fragment === INVITE_FRAGMENT,
    });
  }
}
