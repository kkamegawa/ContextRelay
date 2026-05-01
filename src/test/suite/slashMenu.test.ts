import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('SlashMenu', () => {
  test('includes /workiq in the slash command menu', () => {
    const slashMenuSourcePath = path.resolve(__dirname, '../../../../src/webview/slashMenu.ts');
    const slashMenuSource = fs.readFileSync(slashMenuSourcePath, 'utf8');

    assert.ok(
      slashMenuSource.includes("command: '/workiq'"),
      '/workiq must be available in the slash menu'
    );
    assert.ok(
      slashMenuSource.includes("label: '/workiq'"),
      '/workiq must have a visible slash menu label'
    );
    assert.ok(
      slashMenuSource.includes('Ask Work IQ'),
      '/workiq must describe the Work IQ command in the slash menu'
    );
  });
});
