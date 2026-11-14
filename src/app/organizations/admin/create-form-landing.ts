import { Injectable, inject } from '@angular/core';
import { FragmentLanding } from '../../core/fragment-landing';
import { AdminContext } from './admin-context';
import { adminPath } from './admin-path';

const CREATE_FORM_FRAGMENTS: Readonly<Record<string, string>> = {
  leagues: 'create-league',
  tournaments: 'create-tournament',
  camps: 'create-camp',
};

/**
 * Provided by the admin area, which renders its pages only once it is ready, so it starts at each arrival
 * and sees a later choice or scroll while the admin area is still loading, before the page with the form exists.
 */
@Injectable()
export class CreateFormLanding extends FragmentLanding {
  constructor() {
    const context = inject(AdminContext);
    super({
      atLoad: (snapshot) => {
        const section = snapshot.firstChild?.url.map((segment) => segment.path).join('/');
        return section !== undefined && CREATE_FORM_FRAGMENTS[section] === snapshot.fragment;
      },
      atArrival: (path, fragment) =>
        Object.entries(CREATE_FORM_FRAGMENTS).some(
          ([section, createFragment]) =>
            path === adminPath(context.slug(), section) && fragment === createFragment,
        ),
    });
  }
}
