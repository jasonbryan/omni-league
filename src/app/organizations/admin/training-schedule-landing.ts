import { Injectable } from '@angular/core';
import { FragmentLanding } from '../../core/fragment-landing';

export const SCHEDULE_FRAGMENT = 'schedule';
const TRAINING_PATH = /^\/app\/organizations\/[^/]+\/training\/[^/]+$/;

/** Provided by the training page, which renders the form only once `getForManagement` answers. */
@Injectable()
export class TrainingScheduleLanding extends FragmentLanding {
  constructor() {
    super({
      atLoad: (snapshot) => snapshot.fragment === SCHEDULE_FRAGMENT,
      atArrival: (path, fragment) => TRAINING_PATH.test(path) && fragment === SCHEDULE_FRAGMENT,
    });
  }
}
