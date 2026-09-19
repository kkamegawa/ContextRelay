import { strict as assert } from 'assert';
import { SLASH_COMMAND_IDS } from '../../slashCommandIds';
import { SlashMenu } from '../../webview/slashMenu';
import { installDom, type DomEnvironment } from './domTestUtils';

suite('SlashMenu', () => {
  test('includes /workiq in the slash command menu', () => {
    assert.ok(
      SLASH_COMMAND_IDS.includes('/workiq'),
      '/workiq must be available in the slash menu'
    );
  });
});

suite('SlashMenu (DOM)', () => {
  const ALL_COMMANDS = [
    '/mail',
    '/teams',
    '/sharepoint',
    '/onedrive',
    '/onenote',
    '/task',
    '/all',
    '/ask',
    '/workiq',
    '/clear'
  ];

  let dom: DomEnvironment;
  let menuEl: HTMLElement;
  let input: HTMLTextAreaElement;
  let selections: string[];
  let menu: SlashMenu;

  setup(async () => {
    dom = await installDom();
    menuEl = dom.byId('slashMenu');
    input = dom.byId<HTMLTextAreaElement>('promptInput');
    selections = [];
    menu = new SlashMenu(menuEl, input, nextValue => selections.push(nextValue));
  });

  teardown(async () => {
    await dom.dispose();
  });

  function rows(): HTMLElement[] {
    return Array.from(menuEl.querySelectorAll<HTMLElement>('.slash-item'));
  }

  function commands(): string[] {
    return rows().map(row => row.dataset.command ?? '');
  }

  function selectedIndexes(): number[] {
    return rows().flatMap((row, index) => (row.classList.contains('selected') ? [index] : []));
  }

  test('renders every slash command on construction without opening the menu', () => {
    assert.deepEqual(commands(), ALL_COMMANDS);
    assert.deepEqual(selectedIndexes(), []);
    assert.equal(menu.isVisible(), false);
    assert.equal(rows()[0].querySelector('.slash-label')?.textContent, '/mail');
    assert.ok(rows()[0].querySelector('.slash-desc')?.textContent);
  });

  test('describes /ask as a guard, not as the only way to use pinned context', () => {
    const askRow = rows()[ALL_COMMANDS.indexOf('/ask')];

    assert.equal(askRow.querySelector('.slash-label')?.textContent, '/ask');
    assert.equal(
      askRow.querySelector('.slash-desc')?.textContent,
      'Ask Microsoft 365 Copilot, but only when pinned snippets or attached files are present'
    );
  });

  test('filters commands by the typed prefix, ignoring case', () => {
    assert.equal(menu.update('/t'), true);
    assert.deepEqual(commands(), ['/teams', '/task']);
    assert.equal(menu.isVisible(), true);
    assert.deepEqual(selectedIndexes(), [0]);
    assert.equal(input.getAttribute('aria-activedescendant'), 'slash-option-0');

    menu.update('/MA');
    assert.deepEqual(commands(), ['/mail']);
  });

  test('stays hidden for text that is not a known slash command', () => {
    assert.equal(menu.update('hello'), false);
    assert.equal(menu.update('/zzz'), false);
    assert.equal(menu.isVisible(), false);
  });

  test('offers only unused combinable source commands after a source command', () => {
    assert.equal(menu.update('/mail '), true);
    assert.deepEqual(commands(), ['/teams', '/sharepoint', '/onedrive', '/onenote', '/task']);

    menu.update('/mail /o');
    assert.deepEqual(commands(), ['/onedrive', '/onenote']);
  });

  test('closes after a command that cannot be combined', () => {
    menu.update('/');
    assert.equal(menu.isVisible(), true);

    assert.equal(menu.update('/ask '), false);
    assert.equal(menu.isVisible(), false);
    assert.equal(menu.update('/mail question /t'), false);
  });

  test('selects the highlighted command with the arrow keys and Enter', () => {
    menu.update('/');

    const down = dom.keyDown('ArrowDown');
    assert.equal(menu.handleKeyDown(down), true);
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(selectedIndexes(), [1]);
    assert.equal(input.getAttribute('aria-activedescendant'), 'slash-option-1');

    menu.handleKeyDown(dom.keyDown('ArrowUp'));
    menu.handleKeyDown(dom.keyDown('ArrowUp'));
    assert.deepEqual(selectedIndexes(), [0]);

    menu.handleKeyDown(dom.keyDown('ArrowDown'));
    const enter = dom.keyDown('Enter');
    assert.equal(menu.handleKeyDown(enter), true);
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(selections, ['/teams ']);
    assert.equal(menu.isVisible(), false);
    assert.equal(input.hasAttribute('aria-activedescendant'), false);
  });

  test('keeps the previous source commands when completing with Tab', () => {
    menu.update('/mail /t');
    menu.handleKeyDown(dom.keyDown('ArrowDown'));

    assert.equal(menu.handleKeyDown(dom.keyDown('Tab')), true);
    assert.deepEqual(selections, ['/mail /task ']);
  });

  test('clamps the selection at the last command', () => {
    menu.update('/t');
    for (let i = 0; i < 5; i += 1) {
      menu.handleKeyDown(dom.keyDown('ArrowDown'));
    }

    assert.deepEqual(selectedIndexes(), [1]);
  });

  test('closes on Escape without selecting and ignores keys while hidden', () => {
    menu.update('/');

    const escape = dom.keyDown('Escape');
    assert.equal(menu.handleKeyDown(escape), true);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(menu.isVisible(), false);

    const hiddenKey = dom.keyDown('Enter');
    assert.equal(menu.handleKeyDown(hiddenKey), false);
    assert.equal(hiddenKey.defaultPrevented, false);
    assert.deepEqual(selections, []);
  });

  test('applies a clicked command', () => {
    menu.update('/mail /o');

    rows()[1].click();

    assert.deepEqual(selections, ['/mail /onenote ']);
    assert.equal(menu.isVisible(), false);
  });

  test('applies a command clicked before any input', () => {
    rows()[ALL_COMMANDS.indexOf('/clear')].click();

    assert.deepEqual(selections, ['/clear ']);
  });
});
