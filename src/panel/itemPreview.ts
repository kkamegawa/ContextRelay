import { ContextItem, ResolvedPreview } from '../models/contextItem';

interface MailItemRaw {
  messageId?: string;
  senderName?: string;
  senderAddress?: string;
  bodyPreview?: string;
}

interface TeamsItemRaw {
  senderName?: string;
  channelName?: string;
  summary?: string;
}

interface RetrievalItemRaw {
  extracts?: string[];
}

interface MailBodyResponse {
  body?: {
    contentType?: string;
    content?: string;
  };
}

export function createFallbackPreview(item: ContextItem): ResolvedPreview {
  const body = getFallbackBody(item);

  switch (item.source) {
    case 'mail': {
      const raw = asMailItemRaw(item.raw);
      const senderText = [raw?.senderName, raw?.senderAddress ? `<${raw.senderAddress}>` : undefined]
        .filter(Boolean)
        .join(' ');

      return {
        source: item.source,
        title: item.title,
        subtitle: senderText || undefined,
        body,
        timestamp: item.timestamp,
        url: item.url
      };
    }
    case 'teams': {
      const raw = asTeamsItemRaw(item.raw);
      const subtitle = [raw?.senderName, raw?.channelName].filter(Boolean).join(' · ');
      return {
        source: item.source,
        title: item.title,
        subtitle: subtitle || undefined,
        body,
        timestamp: item.timestamp,
        url: item.url
      };
    }
    case 'sharepoint':
    case 'onedrive':
    case 'connectors':
      return {
        source: item.source,
        title: item.title,
        body,
        timestamp: item.timestamp,
        relevance: item.relevance,
        url: item.url
      };
    default:
      return {
        source: item.source,
        title: item.title,
        body,
        timestamp: item.timestamp,
        url: item.url
      };
  }
}

export function createMailPreview(item: ContextItem, mailBody?: MailBodyResponse): ResolvedPreview {
  const fallback = createFallbackPreview(item);
  const raw = asMailItemRaw(item.raw);
  const body = extractMailBody(mailBody) || fallback.body;
  const subtitle = [raw?.senderName, raw?.senderAddress ? `<${raw.senderAddress}>` : undefined]
    .filter(Boolean)
    .join(' ');

  return {
    ...fallback,
    subtitle: subtitle || fallback.subtitle,
    body
  };
}

export function getMailMessageId(item: ContextItem): string | undefined {
  return asMailItemRaw(item.raw)?.messageId?.trim() || undefined;
}

function getFallbackBody(item: ContextItem): string {
  if (item.source === 'sharepoint' || item.source === 'onedrive' || item.source === 'connectors') {
    const extracts = asRetrievalItemRaw(item.raw)?.extracts ?? [];
    const joinedExtracts = extracts
      .map(extract => normalizePreviewText(extract))
      .filter(Boolean)
      .join('\n\n');

    if (joinedExtracts) {
      return joinedExtracts;
    }
  }

  if (item.source === 'teams') {
    const summary = asTeamsItemRaw(item.raw)?.summary;
    if (summary) {
      return normalizePreviewText(summary) || 'No preview text is available for this item yet.';
    }
  }

  return normalizePreviewText(item.snippet) || 'No preview text is available for this item yet.';
}

function extractMailBody(mailBody?: MailBodyResponse): string {
  if (!mailBody?.body?.content) {
    return '';
  }

  return normalizePreviewText(mailBody.body.content, mailBody.body.contentType === 'html');
}

export function normalizePreviewText(value: string, isHtml = false): string {
  if (!value?.trim()) {
    return '';
  }

  let normalized = value;

  if (isHtml) {
    normalized = normalized
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/p\s*>/gi, '\n\n')
      .replace(/<\s*\/div\s*>/gi, '\n')
      .replace(/<\s*\/li\s*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ');
  }

  normalized = decodeHtmlEntities(normalized)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return normalized;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)));
}

function asMailItemRaw(raw: unknown): MailItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as MailItemRaw : undefined;
}

function asTeamsItemRaw(raw: unknown): TeamsItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as TeamsItemRaw : undefined;
}

function asRetrievalItemRaw(raw: unknown): RetrievalItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as RetrievalItemRaw : undefined;
}