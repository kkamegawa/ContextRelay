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
    return parsed.hostname.includes('-my.sharepoint.com') || parsed.pathname.includes('/personal/');
  } catch {
    return false;
  }
}

export function buildSearchSnippet(summary?: string, description?: string, webUrl?: string): string {
  const normalizedSummary = summary ? stripSearchMarkup(summary) : '';
  if (normalizedSummary) {
    return normalizedSummary;
  }

  if (description?.trim()) {
    return description.trim();
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
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return webUrl;
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