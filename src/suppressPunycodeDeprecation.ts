// Side-effect module that suppresses Node.js DEP0040
// ("The `punycode` module is deprecated. Please use a userland alternative instead.").
//
// Our extension does not `require('punycode')` itself, but the VS Code
// Extension Host / other modules loaded in the same Node process may, and the
// resulting warning is noisy in the Debug Console. We filter only DEP0040 and
// leave all other warnings untouched.
//
// Import this module as the very first import in `extension.ts` so the patch
// is installed before any other module evaluates.

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

installPunycodeDeprecationFilter();
