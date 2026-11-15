import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmTableImports } from './index';

@Component({
  imports: [HlmTableImports],
  template: `
    <div hlmTableContainer>
      <table hlmTable>
        <caption hlmCaption>
          Standings
        </caption>
        <thead hlmTHead>
          <tr hlmTr>
            <th hlmTh scope="col">Team</th>
          </tr>
        </thead>
        <tbody hlmTBody>
          <tr hlmTr>
            <td hlmTd>Ace</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
class Host {}

const render = () => {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
};

describe('HlmTable', () => {
  it('draws the table across its container, and the head and cells padded', () => {
    const root = render();
    expect([...root.querySelector('table')!.classList]).toEqual(
      expect.arrayContaining(['w-full', 'text-sm']),
    );
    expect([...root.querySelector('th')!.classList]).toEqual(
      expect.arrayContaining(['h-10', 'px-2', 'font-medium']),
    );
    expect([...root.querySelector('td')!.classList]).toEqual(expect.arrayContaining(['p-2']));
  });

  it('closes each row with a border', () => {
    const root = render();
    expect([...root.querySelector('tr')!.classList]).toContain('border-b');
  });
});
