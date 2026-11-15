import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PageTitle, PageTitleStrategy } from './page-title';

@Component({ template: 'page' })
class BlankPage {}

const routes = [
  { path: 'items/:id', title: 'Item | Omni League', component: BlankPage },
  { path: 'other', title: 'Other | Omni League', component: BlankPage },
  { path: 'bare', title: 'Omni League', component: BlankPage },
  { path: 'untitled', component: BlankPage },
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

  it('applies the route title when the route comes back after a route without a title', async () => {
    configure();
    await RouterTestingHarness.create('/items/1');
    await TestBed.inject(Router).navigateByUrl('/untitled');
    TestBed.inject(PageTitle).set(['Public page']);
    await TestBed.inject(Router).navigateByUrl('/items/1');
    expect(TestBed.inject(Title).getTitle()).toBe('Item | Omni League');
  });
});
