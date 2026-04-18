// Pure module that exports `installPunycodeDeprecationFilter`.
// It does NOT install the filter at import time — call the function explicitly,
// or import the side-effect entry `suppressPunycodeDeprecation.install.ts`.
//
// The filter suppresses the Node.js DEP0040 ("The `punycode` module is
// deprecated") warning. A warning is dropped when EITHER:
//   - its explicit code is 'DEP0040', OR
//   - no code is provided and the message text matches the punycode pattern.
// All other warnings are forwarded to the original `process.emitWarning`.

type EmitWarning = typeof process.emitWarning;

interface PatchedEmitWarning extends EmitWarning {
  __contextRelayPunycodePatch?: true;
}

function isPunycodeDeprecation(
  warning: string | Error,
  typeOrOptions?: string | (NodeJS.EmitWarningOptions | undefined),
  code?: string
): boolean {
  const explicitCode =
    code ??
    (typeof typeOrOptions === 'object' && typeOrOptions !== null
      ? typeOrOptions.code
      : undefined);

  if (explicitCode === 'DEP0040') {
    return true;
  }

  const message = typeof warning === 'string' ? warning : warning?.message ?? '';
  return /\bpunycode\b[^\n]*\bdeprecated\b/i.test(message);
}

export function installPunycodeDeprecationFilter(): void {
  const current = process.emitWarning as PatchedEmitWarning;
  if (current.__contextRelayPunycodePatch) {
    return;
  }

  const original = current.bind(process) as EmitWarning;

  const patched: PatchedEmitWarning = function emitWarning(
    this: unknown,
    warning: string | Error,
    typeOrOptions?: string | NodeJS.EmitWarningOptions,
    code?: string,
    ctor?: (...args: unknown[]) => unknown
  ): void {
    if (isPunycodeDeprecation(warning, typeOrOptions, code)) {
      return;
    }
    // Delegate to the original implementation preserving all overloads.
    return (original as (...a: unknown[]) => void)(
      warning,
      typeOrOptions as never,
      code as never,
      ctor as never
    );
  } as PatchedEmitWarning;

  patched.__contextRelayPunycodePatch = true;
  process.emitWarning = patched;
}
