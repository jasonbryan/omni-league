import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';

@Component({ template: '' })
class ProgramsStub {}

async function open(url: string): Promise<{ harness: RouterTestingHarness; router: Router }> {
  const leagues = routes.find((route) => route.path === 'leagues');
  TestBed.configureTestingModule({
    providers: [provideRouter([leagues!, { path: 'programs', component: ProgramsStub }])],
  });
  const harness = await RouterTestingHarness.create(url);
  return { harness, router: TestBed.inject(Router) };
}

describe('the /leagues route', () => {
  it('sends the router to Find a program with the known parameters only', async () => {
    const { router } = await open('/leagues?q=coed&sport=soccer&canary=1');
    expect(router.url).toBe('/programs?type=league&q=coed&sport=soccer');
  });

  it('sends a bare /leagues to the leagues of Find a program', async () => {
    const { router } = await open('/leagues');
    expect(router.url).toBe('/programs?type=league');
  });

  it('is followed by a navigation from inside the app', async () => {
    const { harness, router } = await open('/programs');
    await harness.navigateByUrl('/leagues?sport=softball&page=2');
    expect(router.url).toBe('/programs?type=league&sport=softball&page=2');
  });
});
