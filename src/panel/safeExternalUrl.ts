export function normalizeSafeExternalUrl(
  url: unknown,
  allowedProtocols: readonly string[] = ['http:', 'https:']
): string | undefined {
  if (typeof url !== 'string') {
    return undefined;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (!allowedProtocols.includes(parsed.protocol)) {
      return undefined;
    }

    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}
