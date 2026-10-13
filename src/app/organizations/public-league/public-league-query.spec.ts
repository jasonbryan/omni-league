import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlSerializer } from '@angular/router';
import { QueryTolerantUrlSerializer } from '../../core/url-serializer';
import { parseListPage } from '../../core/list-page';
import { publicLeagueCanonicalPath, publicLeaguePath } from './public-league-path';

// Tester probes (#127): hostile query strings on the league page's URL go through the app's
// query-tolerant serializer and the router, and the page asked for is a whole number from the
// bare path or from one canonical `page` value, never any other part of the query string.

@Component({ template: '' })
class Blank {}

describe('the league page URL with a hostile query string', () => {
  async function pageAsked(url: string): Promise<{ page: number; path: string }> {
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
        provideRouter([{ path: 'organizations/:orgSlug/leagues/:leagueSlug', component: Blank }]),
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const tree = router.parseUrl(router.url);
    const values = tree.queryParamMap.getAll('page');
    const path = router.url.split(/[?#]/)[0];
    return { page: parseListPage(values), path };
  }

  it.each([
    ['?page=%', 1],
    ['?page=%E0%A4%A', 1],
    ['?%', 1],
    ['?page=2&x=%', 1],
    ['?x=%&page=2', 1],
    ['?page=abc', 1],
    ['?page=0', 1],
    ['?page=-1', 1],
    ['?page=2&page=3', 1],
    ['?page=2&page=abc', 1],
    ['?page[]=2', 1],
    ['?page=2%0a', 1],
    ['?page=%EF%BC%92', 1],
    ['?page=%2B2', 1],
    ['?page=1e3', 1],
    ['?page=99999999999999999999', 1],
    ['?PAGE=2', 1],
    ['?page=%32', 2],
    ['?page=2', 2],
    ['?page=40', 40],
    ['?page=2#seasons', 2],
    ['?page=2#%', 2],
    ['?page=%#seasons', 1],
  ])('%s asks for page %i', async (search, expected) => {
    const { page, path } = await pageAsked(`/organizations/acme/leagues/sunday${search}`);
    expect(page).toBe(expected);
    expect(path).toBe('/organizations/acme/leagues/sunday');
    expect(Number.isInteger(page)).toBe(true);
    // The canonical and links are built from slugs and the integer, never from the request.
    expect(publicLeagueCanonicalPath('acme', 'sunday', page)).toBe(
      page > 1
        ? `${publicLeaguePath('acme', 'sunday')}?page=${page}`
        : publicLeaguePath('acme', 'sunday'),
    );
  });
});
