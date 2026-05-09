const HTML_ENTITY_PATTERN = /&(nbsp|amp|lt|gt|quot|#39|#x[0-9a-f]+|#\d+);/gi;
const WORDPROCESSING_TOKEN_PATTERN = /<[^>]+>|[^<]+/g;
const WORDPROCESSING_TEXT_START_TAG_PATTERN = /^<w:(?:t|instrText)\b/i;
const WORDPROCESSING_TEXT_END_TAG_PATTERN = /^<\/w:(?:t|instrText)>/i;
const WORDPROCESSING_TAB_TAG_PATTERN = /^<w:tab\b[^>]*\/?>/i;
const WORDPROCESSING_LINE_BREAK_TAG_PATTERN = /^<w:(?:br|cr)\b[^>]*\/?>/i;
const WORDPROCESSING_PARAGRAPH_END_TAG_PATTERN = /^<\/w:p>/i;

export function decodeHtmlEntitiesOnce(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, entity => decodeHtmlEntity(entity));
}

export function extractWordprocessingText(xml: string): string {
  const parts: string[] = [];
  let isInsideTextRun = false;

  for (const token of xml.match(WORDPROCESSING_TOKEN_PATTERN) ?? []) {
    if (!token.startsWith('<')) {
      if (isInsideTextRun) {
        parts.push(decodeHtmlEntitiesOnce(token));
      }
      continue;
    }

    if (WORDPROCESSING_TEXT_START_TAG_PATTERN.test(token)) {
      isInsideTextRun = !token.endsWith('/>');
      continue;
    }

    if (WORDPROCESSING_TEXT_END_TAG_PATTERN.test(token)) {
      isInsideTextRun = false;
      continue;
    }

    if (WORDPROCESSING_TAB_TAG_PATTERN.test(token)) {
      parts.push('\t');
      continue;
    }

    if (WORDPROCESSING_LINE_BREAK_TAG_PATTERN.test(token)) {
      parts.push('\n');
      continue;
    }

    if (WORDPROCESSING_PARAGRAPH_END_TAG_PATTERN.test(token)) {
      parts.push('\n\n');
    }
  }

  return normalizeExtractedText(parts.join(''));
}

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeHtmlEntity(entity: string): string {
  switch (entity.toLowerCase()) {
    case '&nbsp;':
      return ' ';
    case '&amp;':
      return '&';
    case '&lt;':
      return '<';
    case '&gt;':
      return '>';
    case '&quot;':
      return '"';
    case '&#39;':
      return "'";
    default:
      return decodeNumericEntity(entity);
  }
}

function decodeNumericEntity(entity: string): string {
  if (entity.startsWith('&#x') || entity.startsWith('&#X')) {
    return decodeCodePoint(entity.slice(3, -1), 16, entity);
  }

  if (entity.startsWith('&#')) {
    return decodeCodePoint(entity.slice(2, -1), 10, entity);
  }

  return entity;
}

function decodeCodePoint(value: string, radix: number, fallback: string): string {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  return String.fromCodePoint(codePoint);
}
