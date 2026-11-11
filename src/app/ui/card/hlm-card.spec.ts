import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmCardImports } from './index';

@Component({
  imports: [HlmCardImports],
  template: `
    <div hlmCard size="lg">
      <div hlmCardHeader>
        <h3 hlmCardTitle>Title</h3>
        <p hlmCardDescription>Description</p>
        <div hlmCardAction>Action</div>
      </div>
      <div hlmCardContent>Content</div>
    </div>
    <div hlmCard></div>
  `,
})
class Host {}

describe('HlmCard', () => {
  it('sets each part’s slot and the card’s size, defaulting to default', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const slots = [...root.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'));
    expect(slots).toEqual([
      'card',
      'card-header',
      'card-title',
      'card-description',
      'card-action',
      'card-content',
      'card',
    ]);
    const [large, plain] = root.querySelectorAll('[data-slot="card"]');
    expect(large?.getAttribute('data-size')).toBe('lg');
    expect(plain?.getAttribute('data-size')).toBe('default');
    expect(large?.classList).toContain('rounded-xl');
  });
});
