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

  it.each(['/x', '/x?ref=%41', '/x?q=1#top', '/x/(y)', '/a;b=c?d=e', '/?q=%25'])(
    'reads %s as the default serializer does',
    (url) => {
      expect(serializer.serialize(serializer.parse(url))).toBe(plain.serialize(plain.parse(url)));
    },
  );

  it.each(['/%', '/%?q=1', '/%?q=%', '/a(b', '/a(?q=%'])(
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
});
