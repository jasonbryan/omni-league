import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { dispatchSubmit } from '../core/testing/dispatch-submit';
import { TopBarFind } from './top-bar-find';

function open() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(TopBarFind);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const field = root.querySelector<HTMLInputElement>('input[name="q"]')!;
  field.value = ' coed ';
  return { form: root.querySelector('form')!, navigate };
}

describe('TopBarFind submit', () => {
  it('navigates through the router with the trimmed query and prevents the form submission', () => {
    const { form, navigate } = open();
    const { preventDefaultCalls } = dispatchSubmit(form);
    expect(preventDefaultCalls()).toBe(1);
    expect(navigate).toHaveBeenCalledWith(['/programs'], { queryParams: { q: 'coed' } });
  });

  it('leaves a replayed submit to the browser: no preventDefault and no router navigation', () => {
    const { form, navigate } = open();
    const { preventDefaultCalls } = dispatchSubmit(form, { replayed: true });
    expect(preventDefaultCalls()).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});
