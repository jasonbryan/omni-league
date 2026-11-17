import { convertToParamMap } from '@angular/router';
import { programsLocation } from './programs-location';

const params = (query: string) => {
  const values: Record<string, string[]> = {};
  for (const [name, value] of new URLSearchParams(query)) (values[name] ??= []).push(value);
  return convertToParamMap(values);
};

describe('programsLocation', () => {
  it('is the leagues of Find a program for a bare /leagues', () => {
    expect(programsLocation(params(''))).toBe('/programs?type=league');
  });

  it('keeps the search and the sport, and drops any other parameter', () => {
    expect(programsLocation(params('q=coed&sport=soccer&canary=1'))).toBe(
      '/programs?type=league&q=coed&sport=soccer',
    );
  });

  it('keeps the division filters in the order the filter form submits them, and the page above 1', () => {
    expect(
      programsLocation(params('page=2&age=u10&sport=soccer&gender=girls&format=7v7&level=rec')),
    ).toBe('/programs?type=league&sport=soccer&gender=girls&format=7v7&level=rec&age=u10&page=2');
  });

  it('reads the parameters as the page does: a repeated or malformed one gives its default', () => {
    expect(programsLocation(params('q=a&q=b&sport=soccer&sport=softball&page=2&page=3'))).toBe(
      '/programs?type=league&q=a&sport=soccer',
    );
    expect(programsLocation(params('page=abc&sport=cricket&q=%20%20&gender=zzz'))).toBe(
      '/programs?type=league',
    );
    expect(programsLocation(params('page=1'))).toBe('/programs?type=league');
  });

  it('is always the league type, whatever a type parameter says', () => {
    expect(programsLocation(params('type=tournament'))).toBe('/programs?type=league');
  });

  it('encodes the search, so a value cannot add a parameter', () => {
    expect(programsLocation(params('q=a%26canary%3D1%23x'))).toBe(
      '/programs?type=league&q=a%26canary%3D1%23x',
    );
  });
});
