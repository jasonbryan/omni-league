import { findPath } from './find-path';

describe('findPath', () => {
  it('is the bare path for no search', () => {
    expect(findPath('')).toBe('/leagues');
  });

  it('encodes the search into the q parameter', () => {
    expect(findPath('north beach')).toBe('/leagues?q=north%20beach');
    expect(findPath('a&b=c#d')).toBe('/leagues?q=a%26b%3Dc%23d');
  });
});
