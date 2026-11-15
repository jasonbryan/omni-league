import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PageTitle, PageTitleStrategy } from './page-title';

@Component({ template: 'page' })
class BlankPage {}

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Frame {}

const routes = [
  {
    path: 'o/:org',
    component: Frame,
    children: [{ path: 'items', title: 'Org items | Omni League', component: BlankPage }],
  },
  { path: 'items/:id', title: 'Item | Omni League', component: BlankPage },
  { path: 'other', title: 'Other | Omni League', component: BlankPage },
  { path: 'bare', title: 'Omni League', component: BlankPage },
  { path: 'untitled', component: BlankPage },
  {
    path: 'orgs/:slug',
    component: BlankPage,
    children: [
      { path: 'leagues', title: 'Leagues | Omni League', component: BlankPage },
      { path: 'staff', title: 'Staff | Omni League', component: BlankPage },
    ],
  },
];

function configure(): void {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), { provide: TitleStrategy, useClass: PageTitleStrategy }],
  });
}

describe('PageTitle', () => {
  it('writes the tab title with the site name last and the bar text from the first part', () => {
    configure();
    TestBed.inject(PageTitle).set(['Sunday Reverse Coed 4s', 'Gulf Coast Sport & Social']);
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Sunday Reverse Coed 4s | Gulf Coast Sport & Social | Omni League',
    );
    expect(TestBed.inject(PageTitle).barText()).toBe('Sunday Reverse Coed 4s');
  });

  it('shows the bar option in the bar and keeps every part in the tab title', () => {
    configure();
    TestBed.inject(PageTitle).set(['Overview', 'Gulf Coast Sport & Social'], {
      bar: 'Gulf Coast Sport & Social',
    });
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Overview | Gulf Coast Sport & Social | Omni League',
    );
    expect(TestBed.inject(PageTitle).barText()).toBe('Gulf Coast Sport & Social');
  });

  it('falls back to the site name when no part is given', () => {
    configure();
    const pageTitle = TestBed.inject(PageTitle);
    pageTitle.set(['Home']);
    pageTitle.set([]);
    expect(TestBed.inject(Title).getTitle()).toBe('Omni League');
    expect(pageTitle.barText()).toBe('Omni League');
  });

  it('starts with the site name in the bar', () => {
    configure();
    expect(TestBed.inject(PageTitle).barText()).toBe('Omni League');
  });
});

describe('PageTitleStrategy', () => {
  it('hands a route title to PageTitle without the site name', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/other');
    expect(harness.routeNativeElement).not.toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Other | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Other');
  });

  it('reads a route titled only with the site name as the site name', async () => {
    configure();
    await RouterTestingHarness.create('/bare');
    expect(TestBed.inject(Title).getTitle()).toBe('Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Omni League');
  });

  it('changes nothing for a route without a title', async () => {
    configure();
    await RouterTestingHarness.create('/other');
    await TestBed.inject(Router).navigateByUrl('/untitled');
    expect(TestBed.inject(Title).getTitle()).toBe('Other | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Other');
  });

  it('applies the route title again when the route changes', async () => {
    configure();
    await RouterTestingHarness.create('/items/1');
    TestBed.inject(PageTitle).set(['Loaded item', 'Organization']);
    await TestBed.inject(Router).navigateByUrl('/other');
    expect(TestBed.inject(Title).getTitle()).toBe('Other | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Other');
  });

  it('applies the route title again when only a path parameter changes', async () => {
    configure();
    await RouterTestingHarness.create('/items/1');
    TestBed.inject(PageTitle).set(['Loaded item', 'Organization']);
    await TestBed.inject(Router).navigateByUrl('/items/2');
    expect(TestBed.inject(Title).getTitle()).toBe('Item | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Item');
  });

  it('keeps the data title through a navigation that changes only the fragment', async () => {
    configure();
    await RouterTestingHarness.create('/items/1');
    TestBed.inject(PageTitle).set(['Loaded item', 'Organization']);
    await TestBed.inject(Router).navigateByUrl('/items/1#add-session');
    await TestBed.inject(Router).navigateByUrl('/items/1');
    expect(TestBed.inject(Title).getTitle()).toBe('Loaded item | Organization | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Loaded item');
  });

  it('keeps the data title through a navigation that changes only the query string', async () => {
    configure();
    await RouterTestingHarness.create('/items/1');
    TestBed.inject(PageTitle).set(['Loaded item', 'Organization']);
    await TestBed.inject(Router).navigateByUrl('/items/1?season=2#top');
    expect(TestBed.inject(Title).getTitle()).toBe('Loaded item | Organization | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Loaded item');
  });

  it('applies the child route title when only a parent path parameter changes', async () => {
    configure();
    await RouterTestingHarness.create('/o/1/items');
    TestBed.inject(PageTitle).set(['Loaded for org 1']);
    await TestBed.inject(Router).navigateByUrl('/o/2/items');
    expect(TestBed.inject(Title).getTitle()).toBe('Org items | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Org items');
  });

  it('counts each route title it applies, and not a navigation that keeps the data title', async () => {
    configure();
    const pageTitle = TestBed.inject(PageTitle);
    await RouterTestingHarness.create('/items/1');
    const afterFirst = pageTitle.routeTitles();
    await TestBed.inject(Router).navigateByUrl('/items/1#top');
    expect(pageTitle.routeTitles()).toBe(afterFirst);
    await TestBed.inject(Router).navigateByUrl('/items/2');
    expect(pageTitle.routeTitles()).toBe(afterFirst + 1);
  });

  it('applies the route title when the route comes back after a route without a title', async () => {
    configure();
    await RouterTestingHarness.create('/items/1');
    await TestBed.inject(Router).navigateByUrl('/untitled');
    TestBed.inject(PageTitle).set(['Public page']);
    await TestBed.inject(Router).navigateByUrl('/items/1');
    expect(TestBed.inject(Title).getTitle()).toBe('Item | Omni League');
  });

  it('applies the section title again when only the parent organization slug changes', async () => {
    configure();
    await RouterTestingHarness.create('/orgs/alpha/leagues');
    TestBed.inject(PageTitle).set(['Leagues', 'Alpha Club']);
    await TestBed.inject(Router).navigateByUrl('/orgs/beta/leagues');
    expect(TestBed.inject(Title).getTitle()).toBe('Leagues | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Leagues');
  });

  it('keeps the data title of a section through a fragment or query change under the same organization', async () => {
    configure();
    await RouterTestingHarness.create('/orgs/alpha/leagues');
    TestBed.inject(PageTitle).set(['Leagues', 'Alpha Club']);
    await TestBed.inject(Router).navigateByUrl('/orgs/alpha/leagues?page=2#create-league');
    expect(TestBed.inject(Title).getTitle()).toBe('Leagues | Alpha Club | Omni League');
    expect(TestBed.inject(PageTitle).barText()).toBe('Leagues');
  });

  it('applies the new section title when the section changes under the same organization', async () => {
    configure();
    await RouterTestingHarness.create('/orgs/alpha/leagues');
    TestBed.inject(PageTitle).set(['Leagues', 'Alpha Club']);
    await TestBed.inject(Router).navigateByUrl('/orgs/alpha/staff');
    expect(TestBed.inject(Title).getTitle()).toBe('Staff | Omni League');
  });

  describe('with Back and Forward', () => {
    async function openWithHistory(
      url: string,
    ): Promise<{ back: () => Promise<void>; forward: () => Promise<void> }> {
      configure();
      await RouterTestingHarness.create(url);
      const router = TestBed.inject(Router);
      router.initialNavigation();
      const location = TestBed.inject(Location);
      const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
      return {
        back: async () => {
          location.back();
          await settle();
        },
        forward: async () => {
          location.forward();
          await settle();
        },
      };
    }

    it('keeps the data title when Back and Forward cross a fragment on the same route', async () => {
      const { back, forward } = await openWithHistory('/items/1');
      const router = TestBed.inject(Router);
      TestBed.inject(PageTitle).set(['Loaded item', 'Organization']);
      await router.navigateByUrl('/items/1#add-session');
      await back();
      expect(TestBed.inject(Title).getTitle()).toBe('Loaded item | Organization | Omni League');
      await forward();
      expect(TestBed.inject(Title).getTitle()).toBe('Loaded item | Organization | Omni League');
      expect(TestBed.inject(PageTitle).barText()).toBe('Loaded item');
    });

    it('applies the route title of the page Back and Forward return to', async () => {
      const { back, forward } = await openWithHistory('/items/1');
      const router = TestBed.inject(Router);
      TestBed.inject(PageTitle).set(['Loaded item', 'Organization']);
      await router.navigateByUrl('/other');
      expect(TestBed.inject(PageTitle).barText()).toBe('Other');
      await back();
      expect(TestBed.inject(Title).getTitle()).toBe('Item | Omni League');
      expect(TestBed.inject(PageTitle).barText()).toBe('Item');
      await forward();
      expect(TestBed.inject(Title).getTitle()).toBe('Other | Omni League');
      expect(TestBed.inject(PageTitle).barText()).toBe('Other');
    });

    it('applies the route title when Back returns to the same route with other parameters', async () => {
      const { back } = await openWithHistory('/orgs/alpha/leagues');
      const router = TestBed.inject(Router);
      TestBed.inject(PageTitle).set(['Leagues', 'Alpha Club']);
      await router.navigateByUrl('/orgs/beta/leagues');
      TestBed.inject(PageTitle).set(['Leagues', 'Beta Club']);
      await back();
      expect(TestBed.inject(Title).getTitle()).toBe('Leagues | Omni League');
      expect(TestBed.inject(PageTitle).barText()).toBe('Leagues');
    });
  });
});
