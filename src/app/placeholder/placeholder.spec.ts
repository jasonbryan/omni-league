import { TestBed } from '@angular/core/testing';
import { Placeholder } from './placeholder';

describe('Placeholder', () => {
  it('renders a single h1 reading "Omni League" and nothing else', async () => {
    const fixture = TestBed.createComponent(Placeholder);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const headings = host.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Omni League');
    expect(host.children).toHaveLength(1);
  });
});
