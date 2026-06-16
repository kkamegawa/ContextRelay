export function normalizeSafeExternalUrl(
  url: string,
  allowedProtocols: readonly string[] = ['http:', 'https:']
): string | undefined {
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
