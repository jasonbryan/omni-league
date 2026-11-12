import { greeting } from './greeting';

describe('greeting', () => {
  it.each([
    ['Tasha Greene', 'Hi, Tasha'],
    ['  Devon  Park ', 'Hi, Devon'],
    ['Cher', 'Hi, Cher'],
    ['   ', 'Hi'],
    ['', 'Hi'],
  ])('reads "%s" as "%s"', (name, expected) => {
    expect(greeting(name)).toBe(expected);
  });

  it('reads "Hi" while the name is not known', () => {
    expect(greeting(undefined)).toBe('Hi');
  });

  it('splits on any whitespace', () => {
    expect(greeting('\tTasha\nGreene')).toBe('Hi, Tasha');
  });
});
