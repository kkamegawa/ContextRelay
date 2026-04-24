import { getPreviewText, ResolvedPreview } from '../models/contextItem';
import { getSourceLabel } from '../sourcePresentation';
export function buildPreviewDocument(preview: ResolvedPreview): string {
  const lines = [`# ${preview.title}`, ''];
  const metadata: string[] = [
    `- Source: ${getSourceLabel(preview.source)}`,
    preview.subtitle ? `- Context: ${preview.subtitle}` : undefined,
    preview.timestamp ? `- Timestamp: ${preview.timestamp}` : undefined,
    preview.url ? `- Link: ${preview.url}` : undefined
  ].filter((value): value is string => Boolean(value));

  lines.push(...metadata);

  if (metadata.length > 0) {
    lines.push('');
  }

  lines.push(getPreviewText(preview) || 'No preview text is available for this item yet.');
  return lines.join('\n');
}

export function buildPreviewWebviewHtml(preview: ResolvedPreview, cspSource: string): string {
  const metadata: string[] = [
    `<div class="meta-label">Source</div><div class="meta-value">${escapeHtml(getSourceLabel(preview.source))}</div>`,
    preview.subtitle ? `<div class="meta-label">Context</div><div class="meta-value">${escapeHtml(preview.subtitle)}</div>` : '',
    preview.timestamp ? `<div class="meta-label">Timestamp</div><div class="meta-value">${escapeHtml(preview.timestamp)}</div>` : '',
    preview.url ? `<div class="meta-label">Link</div><div class="meta-value">${buildPreviewLinkMarkup(preview.url)}</div>` : ''
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(preview.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
    }
    body {
      margin: 0;
      padding: 24px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.6;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.3;
      word-break: break-word;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 12px;
      padding: 16px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 85%, var(--vscode-inputOption-activeBorder, #888) 15%);
    }
    .meta-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .meta-value {
      word-break: break-word;
    }
    .preview-body {
      padding: 20px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 16px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-inputOption-activeBorder, #888) 12%);
      overflow-x: auto;
    }
    .preview-body-text {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .preview-body-html :first-child {
      margin-top: 0;
    }
    .preview-body-html :last-child {
      margin-bottom: 0;
    }
    .preview-body-html table {
      width: 100%;
      border-collapse: collapse;
    }
    .preview-body-html th,
    .preview-body-html td {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 8px;
      vertical-align: top;
    }
    .preview-body-image {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }
    .preview-body-image img {
      width: 100%;
      height: auto;
      border-radius: 12px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    .preview-image-caption {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      white-space: pre-wrap;
      word-break: break-word;
    }
    a {
      color: var(--vscode-textLink-foreground);
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(preview.title)}</h1>
    ${metadata.length > 0 ? `<section class="meta-grid">${metadata.join('')}</section>` : ''}
    ${buildPreviewBodyHtml(preview)}
  </main>
</body>
</html>`;
}

function buildPreviewBodyHtml(preview: ResolvedPreview): string {
  switch (preview.content.kind) {
    case 'html':
      return `<section class="preview-body preview-body-html">${preview.content.html}</section>`;
    case 'image':
      return `<section class="preview-body preview-body-image"><img src="${escapeAttribute(preview.content.src)}" alt="${escapeAttribute(preview.content.alt ?? preview.title)}">${getPreviewText(preview) ? `<div class="preview-image-caption">${escapeHtml(getPreviewText(preview))}</div>` : ''}</section>`;
    default:
      return `<section class="preview-body preview-body-text">${escapeHtml(getPreviewText(preview) || 'No preview text is available for this item yet.')}</section>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function buildPreviewLinkMarkup(url: string): string {
  const safeUrl = getSafeExternalUrl(url);
  if (!safeUrl) {
    return escapeHtml(url);
  }

  const escaped = escapeAttribute(safeUrl);
  return `<a href="${escaped}" target="_blank" rel="noreferrer noopener">${escapeHtml(safeUrl)}</a>`;
}

function getSafeExternalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}
