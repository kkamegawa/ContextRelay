import sanitizeHtml from 'sanitize-html';
import { ContextItem, PreviewContent, ResolvedPreview } from '../models/contextItem';
import { decodeHtmlEntitiesOnce } from '../textExtraction';

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

interface OneNoteItemRaw {
  sectionName?: string;
  notebookName?: string;
  previewText?: string;
}

interface PlannerItemRaw {
  description?: string;
  planTitle?: string;
  bucketName?: string;
}

interface TodoItemRaw {
  body?: string;
  listName?: string;
  status?: string;
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

const EMPTY_PREVIEW_TEXT = 'No preview text is available for this item yet.';
const SANITIZE_ALLOWED_TAGS = Array.from(new Set([
  ...sanitizeHtml.defaults.allowedTags,
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td'
]));

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
        content: createTextPreviewContent(body),
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
        content: createTextPreviewContent(body),
        timestamp: item.timestamp,
        url: item.url
      };
    }
    case 'onenote': {
      const raw = asOneNoteItemRaw(item.raw);
      const subtitle = [raw?.sectionName, raw?.notebookName].filter(Boolean).join(' · ');
      return {
        source: item.source,
        title: item.title,
        subtitle: subtitle || undefined,
        content: createTextPreviewContent(body),
        timestamp: item.timestamp,
        url: item.url
      };
    }
    case 'planner': {
      const raw = asPlannerItemRaw(item.raw);
      const subtitle = [raw?.planTitle, raw?.bucketName].filter(Boolean).join(' · ');
      return {
        source: item.source,
        title: item.title,
        subtitle: subtitle || undefined,
        content: createTextPreviewContent(body),
        timestamp: item.timestamp,
        url: item.url
      };
    }
    case 'todo': {
      const raw = asTodoItemRaw(item.raw);
      const subtitle = [raw?.listName, raw?.status].filter(Boolean).join(' · ');
      return {
        source: item.source,
        title: item.title,
        subtitle: subtitle || undefined,
        content: createTextPreviewContent(body),
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
        content: createTextPreviewContent(body),
        timestamp: item.timestamp,
        relevance: item.relevance,
        url: item.url
      };
    default:
      return {
        source: item.source,
        title: item.title,
        content: createTextPreviewContent(body),
        timestamp: item.timestamp,
        url: item.url
      };
  }
}

export function createMailPreview(item: ContextItem, mailBody?: MailBodyResponse): ResolvedPreview {
  const fallback = createFallbackPreview(item);
  const raw = asMailItemRaw(item.raw);
  const subtitle = [raw?.senderName, raw?.senderAddress ? `<${raw.senderAddress}>` : undefined]
    .filter(Boolean)
    .join(' ');
  const body = mailBody?.body?.content ?? '';
  const content = body
    ? (mailBody?.body?.contentType === 'html'
        ? createHtmlPreviewContent(body, fallback.content.text)
        : createTextPreviewContent(body))
    : fallback.content;

  return {
    ...fallback,
    subtitle: subtitle || fallback.subtitle,
    content
  };
}

export function getMailMessageId(item: ContextItem): string | undefined {
  return asMailItemRaw(item.raw)?.messageId?.trim() || undefined;
}

export function createTextPreviewContent(value: string): PreviewContent {
  const text = normalizePreviewText(value) || EMPTY_PREVIEW_TEXT;
  return { kind: 'text', text };
}

export function createHtmlPreviewContent(value: string, fallbackText = ''): PreviewContent {
  const html = sanitizePreviewHtml(value);
  const text = normalizePreviewText(html, true) || normalizePreviewText(fallbackText) || EMPTY_PREVIEW_TEXT;

  if (!html) {
    return { kind: 'text', text };
  }

  return { kind: 'html', text, html };
}

export async function createMarkdownPreviewContent(value: string): Promise<PreviewContent> {
  const markdown = normalizeDownloadedText(value);
  if (!markdown) {
    return createTextPreviewContent('');
  }

  const { marked } = await import('marked');
  const rendered = marked.parse(markdown, { breaks: true, gfm: true });
  return createHtmlPreviewContent(typeof rendered === 'string' ? rendered : String(rendered), markdown);
}

export function createStructuredTextPreviewContent(value: string): PreviewContent {
  const text = normalizeDownloadedText(value);
  if (!text) {
    return createTextPreviewContent('');
  }

  return createHtmlPreviewContent(renderTextPreviewHtml(text), text);
}

export function createImagePreviewContent(src: string, options?: { text?: string; alt?: string }): PreviewContent {
  return {
    kind: 'image',
    src,
    alt: options?.alt,
    text: normalizePreviewText(options?.text ?? '') || EMPTY_PREVIEW_TEXT
  };
}

export function renderTextPreviewHtml(value: string): string {
  const normalized = normalizeDownloadedText(value);
  if (!normalized) {
    return '';
  }

  return normalized
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
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

  if (item.source === 'onenote') {
    const previewText = asOneNoteItemRaw(item.raw)?.previewText;
    if (previewText) {
      return normalizePreviewText(previewText) || 'No preview text is available for this item yet.';
    }
  }

  if (item.source === 'planner') {
    const description = asPlannerItemRaw(item.raw)?.description;
    if (description) {
      return normalizePreviewText(description) || 'No preview text is available for this item yet.';
    }
  }

  if (item.source === 'todo') {
    const body = asTodoItemRaw(item.raw)?.body;
    if (body) {
      return normalizePreviewText(body) || 'No preview text is available for this item yet.';
    }
  }

  return normalizePreviewText(item.snippet) || 'No preview text is available for this item yet.';
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

  normalized = decodeHtmlEntitiesOnce(normalized)
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

export function normalizeDownloadedText(value: string): string {
  return value
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizePreviewHtml(value: string): string {
  if (!value?.trim()) {
    return '';
  }

  return sanitizeHtml(value, {
    allowedTags: SANITIZE_ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (_tagName: string, attribs: Record<string, string>) => ({
        tagName: 'a',
        attribs: {
          href: attribs.href,
          target: '_blank',
          rel: 'noreferrer noopener'
        }
      })
    }
  }).trim();
}
function asMailItemRaw(raw: unknown): MailItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as MailItemRaw : undefined;
}

function asTeamsItemRaw(raw: unknown): TeamsItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as TeamsItemRaw : undefined;
}

function asOneNoteItemRaw(raw: unknown): OneNoteItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as OneNoteItemRaw : undefined;
}

function asPlannerItemRaw(raw: unknown): PlannerItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as PlannerItemRaw : undefined;
}

function asTodoItemRaw(raw: unknown): TodoItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as TodoItemRaw : undefined;
}

function asRetrievalItemRaw(raw: unknown): RetrievalItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as RetrievalItemRaw : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
