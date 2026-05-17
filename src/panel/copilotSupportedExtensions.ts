import * as path from 'path';

const COPILOT_SUPPORTED_EXTENSIONS = new Set<string>([
  '.txt', '.md', '.markdown', '.rst',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.xml',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts',
  '.scala', '.sql', '.sh', '.ps1', '.psm1', '.psd1',
  '.html', '.htm', '.css', '.scss', '.less',
  '.vue', '.svelte',
  '.dockerfile', '.env',
  '.gitignore', '.gitattributes',
  '.csv'
]);

const COPILOT_SUPPORTED_BASENAMES = new Set<string>([
  'dockerfile',
  'makefile',
  'readme',
  'license'
]);

export function isCopilotSupportedFileExtension(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  if (COPILOT_SUPPORTED_BASENAMES.has(basename)) {
    return true;
  }

  const extension = path.extname(filePath).toLowerCase();
  return COPILOT_SUPPORTED_EXTENSIONS.has(extension);
}

