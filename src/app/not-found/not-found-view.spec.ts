import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { buttonVariants } from '../ui/button';
import { hlm } from '../ui/utils';
import { NotFoundView } from './not-found-view';

async function render(responseInit?: ResponseInit, publicSite = false): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...(responseInit ? [{ provide: RESPONSE_INIT, useValue: responseInit }] : []),
    ],
  });
  const fixture = TestBed.createComponent(NotFoundView);
  fixture.componentRef.setInput('publicSite', publicSite);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const classList = (element: Element | null | undefined): string[] =>
  (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();

describe('NotFoundView', () => {
  it('sets the response status to 404 when RESPONSE_INIT is provided (server render)', async () => {
    const responseInit: ResponseInit = {};
    await render(responseInit);
    expect(responseInit.status).toBe(404);
  });

  it('renders without throwing when there is no RESPONSE_INIT (browser)', async () => {
    const host = await render();
    expect(host.querySelector('h1')?.textContent.trim()).toBe('Page not found');
  });

  it('sets the document title to "Page not found | Omni League"', async () => {
    await render();
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
  });

  it('renders one h1, one sentence, and one link to / reading "Go to the home page"', async () => {
    const host = await render();
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')?.textContent.trim()).toBe('Page not found');
    expect(host.querySelector('p')?.textContent.trim()).toBe(
      'Check the address for typos, or start again from the home page.',
    );
    const links = host.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/');
    expect(links[0].textContent.trim()).toBe('Go to the home page');
  });

  it('hides both icons from assistive technology', async () => {
    const host = await render();
    const icons = host.querySelectorAll('ng-icon');
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icons[0].querySelector('svg circle')).not.toBeNull();
    expect(icons[1].closest('a')).not.toBeNull();
    expect(icons[1].getAttribute('data-icon')).toBe('inline-start');
  });

  it('uses the classes of the approved mockup state', async () => {
    const host = await render();
    expect(classList(host)).toEqual(
      ['block', 'mx-auto', 'w-full', 'max-w-5xl', 'px-4', 'py-6', 'md:px-8', 'md:py-16'].sort(),
    );
    const card = host.querySelector(':scope > div');
    expect(classList(card)).toEqual(
      [
        'mx-auto',
        'flex',
        'max-w-lg',
        'flex-col',
        'items-center',
        'px-6',
        'py-10',
        'text-center',
        'md:py-12',
        'rounded-xl',
        'bg-card',
        'text-card-foreground',
        'shadow-xs',
        'ring-1',
        'ring-foreground/10',
      ].sort(),
    );
    expect(classList(card?.querySelector(':scope > span'))).toEqual(
      [
        'flex',
        'size-12',
        'items-center',
        'justify-center',
        'rounded-xl',
        'bg-accent',
        'text-accent-foreground',
      ].sort(),
    );
    expect(classList(host.querySelector('h1'))).toEqual(
      ['mt-6', 'text-2xl', 'font-semibold', 'tracking-tight', 'text-balance', 'md:text-3xl'].sort(),
    );
    expect(classList(host.querySelector('p'))).toEqual(
      ['mt-3', 'text-balance', 'text-muted-foreground'].sort(),
    );
  });

  it('styles the home link as hlmBtn size="md" with mt-8', async () => {
    const host = await render();
    const link = host.querySelector('a');
    const expected = hlm(buttonVariants({ size: 'md' }), 'mt-8');
    expect(classList(link)).toEqual(expected.split(/\s+/).sort());
    expect(link?.getAttribute('data-slot')).toBe('button');
  });

  describe('with the way on to the search', () => {
    it('renders one h1, one sentence, and two links: "Find a league" to /leagues, then "Go to the home page" to /', async () => {
      const host = await render(undefined, true);
      expect(host.querySelectorAll('h1')).toHaveLength(1);
      expect(host.querySelector('p')?.textContent.trim()).toBe(
        'Check the address for typos, or find the league you are looking for.',
      );
      const links = [...host.querySelectorAll('a')];
      expect(links.map((a) => [a.textContent.trim(), a.getAttribute('href')])).toEqual([
        ['Find a league', '/leagues'],
        ['Go to the home page', '/'],
      ]);
    });

    it('has no card, a magnifier in the icon square, and the roomier public spacing', async () => {
      const host = await render(undefined, true);
      expect(host.querySelector('.ring-1, .rounded-xl.bg-card, .shadow-xs')).toBeNull();
      expect(classList(host)).toEqual(
        ['block', 'mx-auto', 'w-full', 'max-w-5xl', 'px-4', 'md:px-8', 'py-16', 'md:py-24'].sort(),
      );
      const icons = host.querySelectorAll('ng-icon');
      expect(icons[0].innerHTML).toBe(icons[1].innerHTML);
      expect(classList(host.querySelector(':scope > div'))).toEqual(
        ['mx-auto', 'flex', 'max-w-lg', 'flex-col', 'items-center', 'text-center'].sort(),
      );
    });

    it('hides the icons from assistive technology', async () => {
      const host = await render(undefined, true);
      const icons = host.querySelectorAll('ng-icon');
      expect(icons).toHaveLength(2);
      for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icons[1].closest('a')?.getAttribute('href')).toBe('/leagues');
      expect(icons[1].getAttribute('data-icon')).toBe('inline-start');
    });

    it('styles "Find a league" as the large primary button and the home link as the large outline button, in a row with mt-8', async () => {
      const host = await render(undefined, true);
      const [find, home] = [...host.querySelectorAll('a')];
      expect(classList(find)).toEqual(buttonVariants({ size: 'lg' }).split(/\s+/).sort());
      expect(classList(home)).toEqual(
        buttonVariants({ variant: 'outline', size: 'lg' }).split(/\s+/).sort(),
      );
      expect(find?.getAttribute('data-slot')).toBe('button');
      expect(home?.getAttribute('data-slot')).toBe('button');
      expect(classList(find?.parentElement)).toEqual(
        ['mt-8', 'flex', 'flex-wrap', 'justify-center', 'gap-3'].sort(),
      );
    });
  });
});
