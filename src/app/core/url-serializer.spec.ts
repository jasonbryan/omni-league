import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, provideRouter, Router, UrlSerializer } from '@angular/router';
import { hasUndecodableQuery, QueryTolerantUrlSerializer } from './url-serializer';

// The router cannot decode `?q=%`: it warns NG04018 and navigates to `/`, so a visitor who follows
// a truncated tracking link lands on the home page after hydration (PR #105, tester round 2).

describe('hasUndecodableQuery', () => {
  it.each(['?q=%', '?%', '?q=%E0%A4%A', '?q=%zz', '?a=1&b=%'])('is true for %s', (search) => {
    expect(hasUndecodableQuery(search)).toBe(true);
  });

  it.each(['', '?', '?ref=%41', '?q=(a:b)', '?q=a(b', '?q=1', '?q=%25', '?q=a+b'])(
    'is false for %s',
    (search) => {
      expect(hasUndecodableQuery(search)).toBe(false);
    },
  );
});

describe('QueryTolerantUrlSerializer', () => {
  const serializer = new QueryTolerantUrlSerializer();
  const plain = new DefaultUrlSerializer();

  it.each([
    ['/x?q=%', '/x'],
    ['/organizations/acme?ref=%', '/organizations/acme'],
    ['/?fbclid=%', '/'],
    ['/x/?q=%', '/x/'],
    ['/x?q=%#top', '/x#top'],
    ['/x?a=1&b=%', '/x'],
  ])('drops the undecodable query string of %s and reads %s', (url, bare) => {
    expect(serializer.serialize(serializer.parse(url))).toBe(plain.serialize(plain.parse(bare)));
  });

  // The router decodes the fragment with `decodeURIComponent`, so `/x#%` throws `URIError` and the
  // router would navigate to `/` (#116).
  it.each([
    ['/x#%', '/x'],
    ['/x#%E0%A4%A', '/x'],
    ['/x?q=1#%', '/x?q=1'],
    ['/x?q=%#%', '/x'],
    ['/x/#%', '/x/'],
  ])('drops the undecodable fragment of %s and reads %s', (url, bare) => {
    const tree = serializer.parse(url);
    expect(tree.fragment).toBeNull();
    expect(serializer.serialize(tree)).toBe(plain.serialize(plain.parse(bare)));
  });

  it('keeps a decodable fragment', () => {
    expect(serializer.parse('/x#frag%20ok').fragment).toBe('frag ok');
    expect(serializer.parse('/x?q=%#frag%20ok').fragment).toBe('frag ok');
  });

  it.each(['/x', '/x?ref=%41', '/x?q=1#top', '/x/(y)', '/a;b=c?d=e', '/?q=%25'])(
    'reads %s as the default serializer does',
    (url) => {
      expect(serializer.serialize(serializer.parse(url))).toBe(plain.serialize(plain.parse(url)));
    },
  );

  it.each(['/%', '/%?q=1', '/%?q=%', '/a(b', '/a(?q=%', '/%#%', '/a(b#%'])(
    'still throws for %s, whose path the router cannot read',
    (url) => {
      expect(() => plain.parse(url)).toThrow();
      expect(() => serializer.parse(url)).toThrow();
    },
  );
});

@Component({ template: 'x' })
class XPage {}

@Component({ template: 'home' })
class HomePage {}

describe('the app router with the query-tolerant serializer', () => {
  it('stays on the page for an undecodable query string, with no NG04018 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: HomePage },
          { path: 'x', component: XPage },
        ]),
        provideLocationMocks(),
        { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
      ],
    });
    const router = TestBed.inject(Router);

    // A string URL goes through `Router.parseUrl`, as the browser's URL does on the first navigation.
    await router.navigateByUrl('/x?q=%');

    expect(router.url).toBe('/x');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stays on the page for an undecodable fragment, with no NG04018 warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: HomePage },
          { path: 'x', component: XPage },
        ]),
        provideLocationMocks(),
        { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
      ],
    });
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/x#%');

    expect(router.url).toBe('/x');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // A paging or filter query written by the app (`?leagues=2`) round-trips through the serializer
  // unchanged, including a value the serializer must percent-encode (PR #105, tester round 3).
  it('writes and reads a legitimate query string as the default serializer does', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'x', component: XPage }]),
        provideLocationMocks(),
        { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
      ],
    });
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);

    await router.navigate(['/x'], { queryParams: { leagues: 2 } });
    expect(location.path()).toBe('/x?leagues=2');
    expect(router.routerState.snapshot.root.queryParamMap.get('leagues')).toBe('2');

    await router.navigate(['/x'], {
      queryParams: { q: '100% a&b=c' },
      queryParamsHandling: 'merge',
    });
    expect(location.path()).toBe('/x?leagues=2&q=100%25%20a%26b%3Dc');
    expect(router.routerState.snapshot.root.queryParamMap.get('q')).toBe('100% a&b=c');

    await router.navigateByUrl(location.path());
    expect(router.url).toBe('/x?leagues=2&q=100%25%20a%26b%3Dc');
  });
});
