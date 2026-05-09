import JSZip from 'jszip';
import { ContextItem, ResolvedPreview } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from '../adapters/graphClient';
import { extractWordprocessingText } from '../textExtraction';
import {
  createFallbackPreview,
  createImagePreviewContent,
  createMailPreview,
  createMarkdownPreviewContent,
  createStructuredTextPreviewContent,
  createTextPreviewContent,
  getMailMessageId,
  normalizeDownloadedText,
  normalizePreviewText
} from './itemPreview';

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

type DrivePreviewMode =
  | 'plainText'
  | 'markdown'
  | 'html'
  | 'docx'
  | 'htmlConvertible'
  | 'imageConvertible'
  | 'unsupported';

const TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'jsonl', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml',
  'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'cs', 'go', 'rs', 'sql'
]);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const HTML_CONVERTIBLE_EXTENSIONS = new Set(['eml', 'msg']);
const DOCX_EXTENSIONS = new Set(['docx', 'dotx', 'docm', 'dotm']);
const IMAGE_PREVIEW_EXTENSIONS = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'xls', 'xlsx', 'xlsm']);

export async function resolvePreview(
  item: ContextItem,
  getAccessToken: () => Promise<string>
): Promise<ResolvedPreview> {
  const fallback = createFallbackPreview(item);

  switch (item.source) {
    case 'mail':
      return resolveMailPreview(item, fallback, getAccessToken);
    case 'sharepoint':
    case 'onedrive':
      return resolveDrivePreview(item, fallback, getAccessToken);
    default:
      return fallback;
  }
}

export function inferDrivePreviewMode(name: string, mimeType?: string): DrivePreviewMode {
  const extension = getExtension(name);

  if (DOCX_EXTENSIONS.has(extension)) {
    return 'docx';
  }

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown';
  }

  if (HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }

  if (HTML_CONVERTIBLE_EXTENSIONS.has(extension)) {
    return 'htmlConvertible';
  }

  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) {
    return 'imageConvertible';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'plainText';
  }

  if (mimeType?.startsWith('text/')) {
    return mimeType.includes('markdown') ? 'markdown' : 'plainText';
  }

  if (mimeType === 'application/json' || mimeType === 'application/xml') {
    return 'plainText';
  }

  return 'unsupported';
}

async function resolveMailPreview(
  item: ContextItem,
  fallback: ResolvedPreview,
  getAccessToken: () => Promise<string>
): Promise<ResolvedPreview> {
  const messageId = getMailMessageId(item);
  if (!messageId) {
    return fallback;
  }

  try {
    const token = await getAccessToken();
    const url = `${GRAPH_BASE}/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=body`;
    const response = await graphFetchWithRetry(url, token, { method: 'GET' });
    const data = await handleGraphResponse(response) as MailBodyResponse;
    return createMailPreview(item, data);
  } catch {
    return fallback;
  }
}

async function resolveDrivePreview(
  item: ContextItem,
  fallback: ResolvedPreview,
  getAccessToken: () => Promise<string>
): Promise<ResolvedPreview> {
  const raw = asDriveItemRaw(item.raw);
  if (!raw?.driveId || !raw.id) {
    return fallback;
  }

  const mode = inferDrivePreviewMode(item.title, raw.mimeType);
  if (mode === 'unsupported') {
    return fallback;
  }

  try {
    const token = await getAccessToken();

    switch (mode) {
      case 'plainText': {
        const response = await fetchDriveItemResponse(token, raw.driveId, raw.id);
        const text = normalizeDownloadedText(await response.text());
        return text ? { ...fallback, content: createTextPreviewContent(text) } : fallback;
      }
      case 'markdown': {
        const response = await fetchDriveItemResponse(token, raw.driveId, raw.id);
        const text = normalizeDownloadedText(await response.text());
        return text ? { ...fallback, content: await createMarkdownPreviewContent(text) } : fallback;
      }
      case 'html': {
        const response = await fetchDriveItemResponse(token, raw.driveId, raw.id);
        const html = await response.text();
        return html ? { ...fallback, content: createStructuredTextPreviewContent(normalizePreviewText(html, true)) } : fallback;
      }
      case 'htmlConvertible': {
        const response = await fetchDriveItemResponse(token, raw.driveId, raw.id, { format: 'html' });
        const html = await response.text();
        return html ? { ...fallback, content: createMailLikeHtmlPreview(html, fallback.content.text) } : fallback;
      }
      case 'docx': {
        const response = await fetchDriveItemResponse(token, raw.driveId, raw.id);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const docxPreview = await extractDocxPreview(bytes);
        return docxPreview.text ? { ...fallback, content: createStructuredTextPreviewContent(docxPreview.text) } : fallback;
      }
      case 'imageConvertible': {
        const response = await fetchDriveItemResponse(token, raw.driveId, raw.id, {
          format: 'jpg',
          width: 1600,
          height: 1200
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0) {
          return fallback;
        }

        return {
          ...fallback,
          content: createImagePreviewContent(`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`, {
            text: fallback.content.text,
            alt: `${item.title} preview image`
          })
        };
      }
      default:
        return fallback;
    }
  } catch {
    return fallback;
  }
}

async function fetchDriveItemResponse(
  token: string,
  driveId: string,
  itemId: string,
  options?: { format?: 'html' | 'jpg'; width?: number; height?: number }
): Promise<Response> {
  const query = new URLSearchParams();
  if (options?.format) {
    query.set('format', options.format);
  }
  if (typeof options?.width === 'number') {
    query.set('width', String(options.width));
  }
  if (typeof options?.height === 'number') {
    query.set('height', String(options.height));
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const url = `${GRAPH_BASE}/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content${suffix}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  if (!response.ok) {
    await handleGraphResponse(response);
  }

  return response;
}

async function extractDocxPreview(bytes: Uint8Array): Promise<{ text: string }> {
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

  return { text: parts.join('\n\n').trim() };
}

function getExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index + 1).toLowerCase();
}

function asDriveItemRaw(raw: unknown): DriveItemRaw | undefined {
  return raw && typeof raw === 'object' ? raw as DriveItemRaw : undefined;
}

function createMailLikeHtmlPreview(html: string, fallbackText: string): ResolvedPreview['content'] {
  const preview = createMailPreview(
    {
      source: 'mail',
      title: 'Mail',
      snippet: fallbackText,
      cache: { hit: false }
    },
    { body: { contentType: 'html', content: html } }
  );
  return preview.content;
}
