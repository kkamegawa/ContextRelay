import JSZip from 'jszip';
import { ContextItem } from '../models/contextItem';
import { createMailPreview, getMailMessageId, normalizePreviewText } from '../panel/itemPreview';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';

interface MailBodyResponse {
  body?: {
    contentType?: string;
    content?: string;
  };
}

interface DriveItemRaw {
  id?: string;
  driveId?: string;
  siteId?: string;
  path?: string;
  mimeType?: string;
  extracts?: string[];
}

interface OneNoteItemRaw {
  pageId?: string;
  contentUrl?: string;
  previewText?: string;
}

type DriveContentMode = 'plainText' | 'docx' | 'htmlConvertible' | 'unsupported';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'cs', 'go', 'rs', 'sql'
]);

const HTML_CONVERTIBLE_EXTENSIONS = new Set(['eml', 'msg']);
const DOCX_EXTENSIONS = new Set(['docx', 'dotx', 'docm', 'dotm']);

export async function hydrateItemForHandoff(token: string, item: ContextItem): Promise<ContextItem> {
  switch (item.source) {
    case 'mail':
      return hydrateMailItem(token, item);
    case 'sharepoint':
    case 'onedrive':
      return hydrateDriveItem(token, item);
    case 'onenote':
      return hydrateOneNoteItem(token, item);
    default:
      return item;
  }
}

async function hydrateMailItem(token: string, item: ContextItem): Promise<ContextItem> {
  const messageId = getMailMessageId(item);
  if (!messageId) {
    return item;
  }

  const url = `${GRAPH_BASE}/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=body`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as MailBodyResponse;
  const preview = createMailPreview(item, data);
  return preview.body.trim() ? { ...item, snippet: preview.body } : item;
}

async function hydrateDriveItem(token: string, item: ContextItem): Promise<ContextItem> {
  const raw = asDriveItemRaw(item.raw);
  if (!raw?.driveId || !raw.id) {
    return item;
  }

  const mode = inferDriveContentMode(item.title, raw.mimeType);
  const content = await downloadDriveItemContent(token, raw.driveId, raw.id, mode);
  if (!content.trim()) {
    return item;
  }

  return {
    ...item,
    snippet: content,
    raw: {
      ...raw,
      extracts: [content]
    }
  };
}

async function hydrateOneNoteItem(token: string, item: ContextItem): Promise<ContextItem> {
  const raw = asOneNoteItemRaw(item.raw);
  const pageId = raw?.pageId?.trim();
  if (!pageId) {
    return item;
  }

  const url = `${GRAPH_BASE}/v1.0/me/onenote/pages/${encodeURIComponent(pageId)}/content`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  if (!response.ok) {
    await handleGraphResponse(response);
  }

  const html = await response.text();
  const content = normalizePreviewText(html, true);
  if (!content.trim()) {
    return item;
  }

  return {
    ...item,
    snippet: content,
    raw: {
      ...raw,
      previewText: content,
      extracts: [content]
    }
  };
}

async function downloadDriveItemContent(
  token: string,
  driveId: string,
  itemId: string,
  mode: DriveContentMode
): Promise<string> {
  switch (mode) {
    case 'plainText': {
      const response = await fetchDriveItemResponse(token, driveId, itemId);
      return normalizeDownloadedText(await response.text());
    }
    case 'htmlConvertible': {
      const response = await fetchDriveItemResponse(token, driveId, itemId, 'html');
      const html = await response.text();
      return normalizePreviewText(html, true);
    }
    case 'docx': {
      const response = await fetchDriveItemResponse(token, driveId, itemId);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return normalizeDownloadedText(await extractTextFromDocx(bytes));
    }
    default:
      return '';
  }
}

async function fetchDriveItemResponse(
  token: string,
  driveId: string,
  itemId: string,
  format?: 'html'
): Promise<Response> {
  const suffix = format ? `?format=${format}` : '';
  const url = `${GRAPH_BASE}/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content${suffix}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  if (!response.ok) {
    await handleGraphResponse(response);
  }

  return response;
}

async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = zip.file(/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i);
  const parts: string[] = [];

  for (const entry of entries) {
    const xml = await entry.async('text');
    const text = extractWordprocessingText(xml);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join('\n\n').trim();
}

export function inferDriveContentMode(name: string, mimeType?: string): DriveContentMode {
  const extension = getExtension(name);

  if (DOCX_EXTENSIONS.has(extension)) {
    return 'docx';
  }

  if (HTML_CONVERTIBLE_EXTENSIONS.has(extension)) {
    return 'htmlConvertible';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'plainText';
  }

  if (mimeType?.startsWith('text/')) {
    return 'plainText';
  }

  if (mimeType && ['application/json', 'application/xml'].includes(mimeType)) {
    return 'plainText';
  }

  return 'unsupported';
}

export function extractWordprocessingText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\s*\/?>/gi, '\t')
      .replace(/<w:(?:br|cr)\s*\/?>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function normalizeDownloadedText(value: string): string {
  return value
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index + 1).toLowerCase();
}

function decodeXmlEntities(value: string): string {
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

function asDriveItemRaw(raw: unknown): DriveItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as DriveItemRaw : undefined;
}

function asOneNoteItemRaw(raw: unknown): OneNoteItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as OneNoteItemRaw : undefined;
}
