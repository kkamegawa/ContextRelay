import { strict as assert } from 'assert';
import { installPunycodeDeprecationFilter } from '../../suppressPunycodeDeprecation';

suite('suppressPunycodeDeprecation', () => {
  let original: typeof process.emitWarning;

  setup(() => {
    original = process.emitWarning;
  });

  teardown(() => {
    process.emitWarning = original;
  });

  test('drops warnings with code DEP0040', () => {
    const captured: Array<unknown[]> = [];
    process.emitWarning = ((...args: unknown[]) => {
      captured.push(args);
    }) as typeof process.emitWarning;

    installPunycodeDeprecationFilter();

    process.emitWarning(
      'The `punycode` module is deprecated. Please use a userland alternative instead.',
      'DeprecationWarning',
      'DEP0040'
    );

    assert.equal(captured.length, 0, 'DEP0040 warnings must be suppressed');
  });

  test('drops punycode deprecation message without explicit code', () => {
    const captured: Array<unknown[]> = [];
    process.emitWarning = ((...args: unknown[]) => {
      captured.push(args);
    }) as typeof process.emitWarning;

    installPunycodeDeprecationFilter();

    process.emitWarning(
      'The `punycode` module is deprecated. Please use a userland alternative instead.'
    );

    assert.equal(captured.length, 0, 'punycode deprecation message must be suppressed');
  });

  test('passes through unrelated warnings', () => {
    const captured: Array<unknown[]> = [];
    process.emitWarning = ((...args: unknown[]) => {
      captured.push(args);
    }) as typeof process.emitWarning;

    installPunycodeDeprecationFilter();

    process.emitWarning('Something else is happening', 'Warning', 'WRN0001');
    process.emitWarning(new Error('another issue'));

    assert.equal(captured.length, 2, 'unrelated warnings must pass through');
    assert.equal(captured[0][0], 'Something else is happening');
    assert.equal((captured[1][0] as Error).message, 'another issue');
  });

  test('is idempotent across multiple installations', () => {
    const captured: Array<unknown[]> = [];
    process.emitWarning = ((...args: unknown[]) => {
      captured.push(args);
    }) as typeof process.emitWarning;

    installPunycodeDeprecationFilter();
    const afterFirst = process.emitWarning;
    installPunycodeDeprecationFilter();
    const afterSecond = process.emitWarning;

    assert.strictEqual(afterFirst, afterSecond, 'filter must not be re-wrapped');

    process.emitWarning('benign', 'Warning', 'OK0001');
    assert.equal(captured.length, 1);
  });
});
