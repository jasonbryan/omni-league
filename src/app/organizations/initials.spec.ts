import { initials } from './initials';

describe('initials', () => {
  it.each([
    ['Gulf Coast Sport & Social', 'GC'],
    ['Port Aransas Beach Volleyball Club', 'PA'],
    ['Coastal', 'C'],
    ['  spaced   out  ', 'SO'],
    ['(Rec) 5th Street', 'R5'],
    ['& - ?', ''],
    ['', ''],
  ])('%j gives %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
