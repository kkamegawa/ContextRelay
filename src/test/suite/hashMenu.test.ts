import { strict as assert } from 'assert';
import { HashMenu } from '../../webview/hashMenu';
import { installDom, type DomEnvironment } from './domTestUtils';

suite('HashMenu', () => {
  let dom: DomEnvironment;
  let menuEl: HTMLElement;
  let input: HTMLTextAreaElement;
  let selections: string[];
  let menu: HashMenu;

  setup(async () => {
    dom = await installDom();
    menuEl = dom.byId('hashMenu');
    input = dom.byId<HTMLTextAreaElement>('promptInput');
    selections = [];
    menu = new HashMenu(menuEl, input, nextValue => selections.push(nextValue));
  });

  teardown(async () => {
    await dom.dispose();
  });

  function typeText(value: string, textBeforeCursor = value): boolean {
    input.value = value;
    return menu.update(textBeforeCursor);
  }

  function rows(): HTMLElement[] {
    return Array.from(menuEl.querySelectorAll<HTMLElement>('.hash-item'));
  }

  function labels(): string[] {
    return rows().map(row => row.querySelector('.hash-label')?.textContent ?? '');
  }

  function selectedIndexes(): number[] {
    return rows().flatMap((row, index) => (row.classList.contains('selected') ? [index] : []));
  }

  test('lists case-insensitive matches for the token under the cursor', () => {
    menu.setFiles(['src/App.ts', 'docs/readme.md', 'src/app.test.ts']);

    assert.equal(typeText('Review #APP'), true);
    assert.deepEqual(labels(), ['src/App.ts', 'src/app.test.ts']);
    assert.equal(menu.isVisible(), true);
    assert.deepEqual(selectedIndexes(), [0]);
    assert.equal(rows()[0].getAttribute('aria-selected'), 'true');
    assert.equal(input.getAttribute('aria-activedescendant'), 'hash-option-0');
  });

  test('caps the list at 50 files', () => {
    menu.setFiles(Array.from({ length: 60 }, (_, index) => `file-${index}.ts`));

    assert.equal(typeText('#file'), true);
    assert.equal(rows().length, 50);
  });

  test('hides when no file matches', () => {
    menu.setFiles(['src/a.ts']);
    typeText('#src');

    assert.equal(typeText('#zzz'), false);
    assert.equal(menu.isVisible(), false);
    assert.equal(input.hasAttribute('aria-activedescendant'), false);
  });

  test('ignores text without a hash token at the cursor', () => {
    menu.setFiles(['src/a.ts']);

    assert.equal(typeText('hello'), false, 'no hash token');
    assert.equal(typeText('#src '), false, 'trailing whitespace closes the token');
    assert.equal(typeText('issue#src'), false, 'a hash must start a whitespace-separated token');
    assert.equal(menu.isVisible(), false);
  });

  test('matches the path after an opening quote, including spaces', () => {
    menu.setFiles(['notes/Release Plan.md', 'src/a.ts']);

    assert.equal(typeText('Read #"notes/Release P'), true);
    assert.deepEqual(labels(), ['notes/Release Plan.md']);

    assert.equal(typeText("Read #'notes"), true);
    assert.deepEqual(labels(), ['notes/Release Plan.md']);
  });

  test('re-filters when the file list changes while the menu is open', () => {
    menu.setFiles(['alpha.ts', 'beta.ts']);
    typeText('#al');
    assert.deepEqual(labels(), ['alpha.ts']);

    menu.setFiles(['alpha.ts', 'also.ts', 'beta.ts']);

    assert.deepEqual(labels(), ['alpha.ts', 'also.ts']);
  });

  test('does not open when the file list changes while the menu is hidden', () => {
    menu.setFiles(['alpha.ts']);

    assert.equal(menu.isVisible(), false);
    assert.equal(rows().length, 0);
  });

  test('moves the selection with the arrow keys and clamps at both ends', () => {
    menu.setFiles(['a1.ts', 'a2.ts', 'a3.ts']);
    typeText('#a');

    const down = dom.keyDown('ArrowDown');
    assert.equal(menu.handleKeyDown(down), true);
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(selectedIndexes(), [1]);
    assert.equal(rows()[1].getAttribute('aria-selected'), 'true');
    assert.equal(rows()[0].getAttribute('aria-selected'), 'false');
    assert.equal(input.getAttribute('aria-activedescendant'), 'hash-option-1');

    menu.handleKeyDown(dom.keyDown('ArrowDown'));
    menu.handleKeyDown(dom.keyDown('ArrowDown'));
    assert.deepEqual(selectedIndexes(), [2]);

    const up = dom.keyDown('ArrowUp');
    assert.equal(menu.handleKeyDown(up), true);
    assert.equal(up.defaultPrevented, true);
    for (let i = 0; i < 4; i += 1) {
      menu.handleKeyDown(dom.keyDown('ArrowUp'));
    }
    assert.deepEqual(selectedIndexes(), [0]);
    assert.equal(input.getAttribute('aria-activedescendant'), 'hash-option-0');
  });

  test('applies the selected file on Enter and hides the menu', () => {
    menu.setFiles(['a1.ts', 'a2.ts']);
    typeText('Summarize #a');
    menu.handleKeyDown(dom.keyDown('ArrowDown'));

    const enter = dom.keyDown('Enter');
    assert.equal(menu.handleKeyDown(enter), true);
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(selections, ['Summarize #a2.ts']);
    assert.equal(menu.isVisible(), false);
    assert.equal(input.hasAttribute('aria-activedescendant'), false);
  });

  test('applies the selected file on Tab', () => {
    menu.setFiles(['a1.ts', 'a2.ts']);
    typeText('#a');

    assert.equal(menu.handleKeyDown(dom.keyDown('Tab')), true);
    assert.deepEqual(selections, ['#a1.ts']);
  });

  test('closes on Escape without applying a selection', () => {
    menu.setFiles(['a1.ts']);
    typeText('#a');

    const escape = dom.keyDown('Escape');
    assert.equal(menu.handleKeyDown(escape), true);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(menu.isVisible(), false);
    assert.deepEqual(selections, []);
  });

  test('leaves keys alone when hidden or unrelated', () => {
    const hiddenKey = dom.keyDown('ArrowDown');
    assert.equal(menu.handleKeyDown(hiddenKey), false);
    assert.equal(hiddenKey.defaultPrevented, false);

    menu.setFiles(['a1.ts']);
    typeText('#a');
    const letter = dom.keyDown('b');
    assert.equal(menu.handleKeyDown(letter), false);
    assert.equal(letter.defaultPrevented, false);
    assert.equal(menu.isVisible(), true);
  });

  test('quotes a selected path that contains spaces', () => {
    menu.setFiles(['notes/Release Plan.md']);
    typeText('Read #"notes/Rel');

    menu.handleKeyDown(dom.keyDown('Enter'));

    assert.deepEqual(selections, ['Read #"notes/Release Plan.md"']);
  });

  test('replaces only the token before the cursor and keeps the rest of the input', () => {
    menu.setFiles(['app.ts']);

    typeText('Compare #ap with docs', 'Compare #ap');
    menu.handleKeyDown(dom.keyDown('Enter'));

    typeText('Compare #apwith docs', 'Compare #ap');
    menu.handleKeyDown(dom.keyDown('Enter'));

    assert.deepEqual(selections, ['Compare #app.ts with docs', 'Compare #app.ts with docs']);
  });

  test('applies a clicked file and hides the menu', () => {
    menu.setFiles(['a1.ts', 'a2.ts', 'a3.ts']);
    typeText('#a');

    rows()[2].click();

    assert.deepEqual(selections, ['#a3.ts']);
    assert.equal(menu.isVisible(), false);
  });
});
