export interface QueryIntent {
  includeOneNoteHierarchy: boolean;
  includePlannerMetadata: boolean;
  includePlannerComments: boolean;
  searchTerms: string[];
}

const FILLER_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'for', 'from', 'in', 'into', 'me', 'my', 'of', 'on',
  'or', 'please', 'search', 'show', 'the', 'to', 'with'
]);

const ONENOTE_HIERARCHY_WORDS = new Set(['section', 'sections', 'notebook', 'notebooks']);
const PLANNER_METADATA_WORDS = new Set([
  'assigned', 'assignment', 'assignments', 'bucket', 'buckets', 'metadata', 'meta', 'status'
]);
const PLANNER_COMMENT_WORDS = new Set(['comment', 'comments', 'conversation', 'thread', 'threads']);

export function parseQueryIntent(query: string): QueryIntent {
  const words = normalizeWords(query);
  const includeOneNoteHierarchy = words.some(word => ONENOTE_HIERARCHY_WORDS.has(word));
  const includePlannerMetadata = words.some(word => PLANNER_METADATA_WORDS.has(word));
  const includePlannerComments = words.some(word => PLANNER_COMMENT_WORDS.has(word));

  const intentWords = new Set<string>([
    ...ONENOTE_HIERARCHY_WORDS,
    ...PLANNER_METADATA_WORDS,
    ...PLANNER_COMMENT_WORDS
  ]);

  const searchTerms = words.filter(word => word.length >= 2 && !FILLER_WORDS.has(word) && !intentWords.has(word));

  return {
    includeOneNoteHierarchy,
    includePlannerMetadata,
    includePlannerComments,
    searchTerms
  };
}

export function scoreMatches(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = normalizeText(text);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWords(query: string): string[] {
  return normalizeText(query).split(' ').filter(Boolean);
}
