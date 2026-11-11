import { expect } from 'vitest';

export function expectPendingSpinner(button: Element | null | undefined): void {
  if (!button) throw new Error('expectPendingSpinner needs an element, got nothing');
  const spinners = button.querySelectorAll('hlm-spinner');
  expect(spinners.length).toBe(1);
  expect(spinners[0].getAttribute('aria-hidden')).toBe('true');
  expect(spinners[0].getAttribute('data-icon')).toBe('inline-start');
  expect(button.querySelector('[role="status"]')).toBeNull();
}
