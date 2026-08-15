import { strict as assert } from 'assert';
import { buildAskInstruction } from '../../panel/askPrompt';

suite('buildAskInstruction', () => {
  test('references Microsoft 365 Copilot as the responder', () => {
    const result = buildAskInstruction('translate to Japanese');
    assert.ok(result.toLowerCase().includes('microsoft 365 copilot'));
  });

  test('instructs the model to follow the user instruction exactly', () => {
    const result = buildAskInstruction('summarize');
    assert.ok(result.includes('Follow the user instruction exactly'));
  });

  test('instructs the model to emit only the requested output format', () => {
    const result = buildAskInstruction('summarize as JSON');
    assert.ok(result.toLowerCase().includes('produce only that format'));
  });

  test('appends the trimmed user instruction at the end', () => {
    const result = buildAskInstruction('  summarize this for me  ');
    assert.ok(result.includes('User instruction:'));
    assert.ok(result.trimEnd().endsWith('summarize this for me'));
  });

  test('does not embed pinned document context — that is carried via additionalContext instead', () => {
    const result = buildAskInstruction('summarize');
    assert.ok(!result.includes('Pinned document'));
    assert.ok(!result.includes('--- Pinned context ---'));
  });
});
