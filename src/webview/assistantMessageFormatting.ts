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

function renderInlineMarkdown(text: string): string {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  let html = '';

  for (const match of text.matchAll(linkPattern)) {
    const [fullMatch, label, url] = match;
    const start = match.index ?? 0;
    html += escapeHtml(text.slice(cursor, start));
    html += `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    cursor = start + fullMatch.length;
  }

  html += escapeHtml(text.slice(cursor));
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderParagraph(lines: string[]): string {
  return `<p>${lines.map(renderInlineMarkdown).join('<br>')}</p>`;
}

function isUnorderedListItem(line: string): boolean {
  return /^[-*]\s+/.test(line);
}

function isOrderedListItem(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function renderList(lines: string[], ordered: boolean): string {
  const tagName = ordered ? 'ol' : 'ul';
  const itemPattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
  const items = lines
    .map(line => line.replace(itemPattern, ''))
    .map(item => `<li>${renderInlineMarkdown(item)}</li>`)
    .join('');

  return `<${tagName}>${items}</${tagName}>`;
}

export function hasRichTextFormatting(text: string): boolean {
  return /(^|\n)#{1,3}\s|(^|\n)([-*]|\d+\.)\s|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)/m.test(text);
}

export function formatAssistantMessageAsHtml(text: string): string {
  const normalizedText = text.replace(/\r\n/g, '\n').trim();
  if (!normalizedText) {
    return '';
  }

  const lines = normalizedText.split('\n');
  const blocks: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trimEnd();

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (isUnorderedListItem(line.trim())) {
      const listLines: string[] = [];
      while (index < lines.length && isUnorderedListItem(lines[index].trim())) {
        listLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderList(listLines, false));
      continue;
    }

    if (isOrderedListItem(line.trim())) {
      const listLines: string[] = [];
      while (index < lines.length && isOrderedListItem(lines[index].trim())) {
        listLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderList(listLines, true));
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim().length > 0) {
      const currentLine = lines[index].trimEnd();
      if (/^(#{1,3})\s+/.test(currentLine) || /^---+$/.test(currentLine.trim()) || isUnorderedListItem(currentLine.trim()) || isOrderedListItem(currentLine.trim())) {
        break;
      }
      paragraphLines.push(currentLine);
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push(renderParagraph(paragraphLines));
      continue;
    }

    index += 1;
  }

  return blocks.join('');
}
