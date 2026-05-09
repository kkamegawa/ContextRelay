export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

export function stripSearchMarkup(value: string): string {
  return value
    .replace(/<c\d+>/g, '')
    .replace(/<\/c\d+>/g, '')
    .replace(/<ddd\/>/g, '…')
    .trim();
}

export function isOneDriveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      /^[a-z0-9-]+-my\.sharepoint\.com$/i.test(parsed.hostname) &&
      /^\/personal\/[^/]+(?:\/|$)/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function buildSearchSnippet(summary?: string, description?: string, webUrl?: string): string {
  const normalizedSummary = summary ? stripSearchMarkup(summary) : '';
  if (normalizedSummary) {
    return normalizedSummary;
  }

  const normalizedDescription = description?.trim() ?? '';
  if (normalizedDescription && !looksLikeRawLocation(normalizedDescription)) {
    return normalizedDescription;
  }

  return formatLocationSnippet(undefined, webUrl);
}

export function formatLocationSnippet(path?: string, webUrl?: string): string {
  if (path?.trim()) {
    return path.replace(/^\/drive\/root:/, '').replace(/\//g, ' / ').trim() || 'Location available';
  }

  if (!webUrl) {
    return '';
  }

  try {
    const parsed = new URL(webUrl);
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => safeDecodeURIComponent(segment))
      .map(segment => segment.trim())
      .filter(Boolean);

    const filteredSegments = trimStorageBoilerplate(segments).filter(segment => segment.toLowerCase() !== 'preview');
    const tail = filteredSegments.slice(-3);
    if (tail.length > 0) {
      return tail.join(' / ');
    }

    return 'Location available';
  } catch {
    return 'Location available';
  }
}

export function getTitleFromUrl(webUrl: string): string | undefined {
  try {
    const parsed = new URL(webUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1];
  } catch {
    return undefined;
  }
}

function looksLikeRawLocation(value: string): boolean {
  return /^https?:\/\//i.test(value) || /(?:^|[\s/])[\w-]+(?:-my)?\.sharepoint\.com\//i.test(value);
}

function trimStorageBoilerplate(segments: string[]): string[] {
  const documentIndex = findLastMatchingIndex(
    segments,
    segment => normalizeSegment(segment) === 'documents' || normalizeSegment(segment) === 'shared documents'
  );
  if (documentIndex !== -1 && documentIndex < segments.length - 1) {
    return segments.slice(documentIndex + 1);
  }

  return segments;
}

function findLastMatchingIndex(values: string[], predicate: (value: string) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      return index;
    }
  }

  return -1;
}

function normalizeSegment(value: string): string {
  return value.replace(/\+/g, ' ').trim().toLowerCase();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
