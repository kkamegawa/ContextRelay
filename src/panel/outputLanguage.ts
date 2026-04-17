/**
 * Heuristics for deciding which editor language to use when opening the
 * Microsoft 365 Copilot response in a new untitled document.
 *
 * The caller passes in both the user prompt and the assistant response.
 * Detection order:
 * 1. If the entire response is wrapped in a single fenced code block, use that
 *    language and return the inner content (fences stripped).
 * 2. Otherwise, look at the *dominant* fenced language used inside the response.
 * 3. Otherwise, fall back to keyword hints in the prompt
 *    (e.g. "markdown", "json", "html").
 * 4. Default to `markdown`.
 */

export interface DetectedOutput {
  language: string;
  content: string;
}

interface LanguageEntry {
  language: string;
  keywords: readonly string[];
}

// Keep the list short and aligned with VS Code's known language ids so
// openTextDocument({ language }) reliably picks a syntax highlighter.
const KEYWORD_LANGUAGES: readonly LanguageEntry[] = [
  { language: 'markdown', keywords: ['markdown', 'md format', 'md file', '.md'] },
  { language: 'json', keywords: ['json'] },
  { language: 'yaml', keywords: ['yaml', 'yml'] },
  { language: 'html', keywords: ['html'] },
  { language: 'xml', keywords: ['xml'] },
  { language: 'csv', keywords: ['csv'] },
  { language: 'typescript', keywords: ['typescript', 'tsx'] },
  { language: 'javascript', keywords: ['javascript', 'jsx'] },
  { language: 'python', keywords: ['python'] },
  { language: 'sql', keywords: ['sql'] },
  { language: 'shellscript', keywords: ['bash', 'shell', 'sh script'] }
];

const FENCE_ALIASES: Readonly<Record<string, string>> = {
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  csv: 'csv',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  ps1: 'powershell',
  powershell: 'powershell',
  txt: 'plaintext',
  text: 'plaintext'
};

function normalizeFenceLanguage(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  return FENCE_ALIASES[key] ?? key;
}

function stripSingleWrappingFence(response: string): DetectedOutput | undefined {
  const trimmed = response.trim();
  // ^```lang\n ... \n```$
  const match = trimmed.match(/^```([^\n`]*)\n([\s\S]*?)\n```$/);
  if (!match) {
    return undefined;
  }
  const inner = match[2];
  // If the inner content itself contains another fenced block, the response
  // is not just a single wrapped block — treat it as mixed content instead.
  if (/```/.test(inner)) {
    return undefined;
  }
  const language = normalizeFenceLanguage(match[1]) ?? 'markdown';
  return { language, content: inner };
}

function findDominantFenceLanguage(response: string): string | undefined {
  const counts = new Map<string, number>();
  const fenceRegex = /```([^\n`]*)\n/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(response)) !== null) {
    const lang = normalizeFenceLanguage(m[1]);
    if (!lang) {
      continue;
    }
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return undefined;
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

function findLanguageFromPrompt(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  for (const entry of KEYWORD_LANGUAGES) {
    if (entry.keywords.some(keyword => lower.includes(keyword))) {
      return entry.language;
    }
  }
  return undefined;
}

export function detectOutputLanguage(prompt: string, response: string): DetectedOutput {
  const wrapped = stripSingleWrappingFence(response);
  if (wrapped) {
    return wrapped;
  }

  const dominantFence = findDominantFenceLanguage(response);
  if (dominantFence) {
    return { language: dominantFence, content: response };
  }

  const fromPrompt = findLanguageFromPrompt(prompt);
  if (fromPrompt) {
    return { language: fromPrompt, content: response };
  }

  return { language: 'markdown', content: response };
}
