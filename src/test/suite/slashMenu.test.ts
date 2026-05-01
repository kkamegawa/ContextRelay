import { strict as assert } from 'assert';
import { SLASH_COMMAND_IDS } from '../../slashCommandIds';

suite('SlashMenu', () => {
  test('includes /workiq in the slash command menu', () => {
    assert.ok(
      SLASH_COMMAND_IDS.includes('/workiq'),
      '/workiq must be available in the slash menu'
    );
  });
});
