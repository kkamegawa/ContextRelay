import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SavedSnippet } from '../models/contextItem';

export interface HandoffContext {
  snippets: SavedSnippet[];
  searchSummary?: string;
}

function utcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendUpdate(filePath: string, content: string): void {
  const prefix = fs.existsSync(filePath) && fs.statSync(filePath).size > 0 ? '\n\n' : '';
  fs.appendFileSync(filePath, `${prefix}${content.trimEnd()}\n`, 'utf8');
}

export class DocGenerator {
  private getOutputDir(): string {
    const config = vscode.workspace.getConfiguration('contextRelay');
    const outputDir = config.get<string>('outputDir', '.contextrelay');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const root = workspaceFolders?.[0]?.uri?.fsPath ?? process.cwd();
    return path.join(root, outputDir);
  }

  generatePlan(context: HandoffContext): string {
    const ts = utcTimestamp();
    const snippetList = context.snippets.length > 0
      ? context.snippets.map(s =>
          `- **${s.name}** (${s.item.source}) — ${s.item.snippet.slice(0, 120)}...`
        ).join('\n')
      : '_No snippets saved._';

    return [
      `## Update (${ts})`,
      '',
      context.searchSummary ? `### Summary\n\n${context.searchSummary}` : '',
      '### Saved Context',
      '',
      snippetList,
      ''
    ].filter(line => line !== undefined).join('\n');
  }

  generateTasks(): string {
    const ts = utcTimestamp();
    return [
      `## Update (${ts})`,
      '',
      '### Open Tasks',
      '',
      '- [ ] Review search results and refine queries as needed.',
      '- [ ] Pin relevant snippets for Copilot handoff.',
      '- [ ] Generate HANDOFF.md before starting a new Copilot Chat session.',
      ''
    ].join('\n');
  }

  generateTestPlan(): string {
    const ts = utcTimestamp();
    return [
      `## Update (${ts})`,
      '',
      '### Test Cases',
      '',
      '- Verify search results match expected content from Microsoft 365.',
      '- Confirm snippets persist across VS Code window reloads.',
      '- Validate handoff document format and timestamps.',
      ''
    ].join('\n');
  }

  generateHandoff(context: HandoffContext): string {
    const ts = utcTimestamp();
    const snippetList = context.snippets.length > 0
      ? context.snippets.map(s => [
          `### ${s.name}`,
          `- **Source**: ${s.item.source}`,
          `- **Saved**: ${s.savedAt}`,
          s.item.url ? `- **Link**: ${s.item.url}` : '',
          '',
          s.item.snippet,
          ''
        ].filter(l => l !== undefined).join('\n')).join('\n')
      : '_No snippets saved._';

    return [
      `## Update (${ts})`,
      '',
      '### Current Decisions',
      '',
      context.searchSummary ?? '_No search summary available._',
      '',
      '### Open Questions',
      '',
      '- _Add open questions here._',
      '',
      '### Next Tasks',
      '',
      '- _Add next tasks here._',
      '',
      '### Saved Snippets',
      '',
      snippetList,
      ''
    ].join('\n');
  }

  async generate(context: HandoffContext): Promise<void> {
    const outputDir = this.getOutputDir();
    ensureDir(outputDir);

    const planPath = path.join(outputDir, 'PLAN.md');
    const tasksPath = path.join(outputDir, 'TASKS.md');
    const testPlanPath = path.join(outputDir, 'TEST_PLAN.md');
    const handoffPath = path.join(outputDir, 'HANDOFF.md');

    appendUpdate(planPath, this.generatePlan(context));
    appendUpdate(tasksPath, this.generateTasks());
    appendUpdate(testPlanPath, this.generateTestPlan());
    appendUpdate(handoffPath, this.generateHandoff(context));
  }

  async generateAll(context: HandoffContext): Promise<string[]> {
    const outputDir = this.getOutputDir();
    ensureDir(outputDir);

    const files: Array<{ name: string; content: string }> = [
      { name: 'PLAN.md', content: this.generatePlan(context) },
      { name: 'TASKS.md', content: this.generateTasks() },
      { name: 'TEST_PLAN.md', content: this.generateTestPlan() },
      { name: 'HANDOFF.md', content: this.generateHandoff(context) }
    ];

    const written: string[] = [];
    for (const file of files) {
      const filePath = path.join(outputDir, file.name);
      appendUpdate(filePath, file.content);
      written.push(filePath);
    }
    return written;
  }

  getHandoffPath(): string {
    return path.join(this.getOutputDir(), 'HANDOFF.md');
  }
}
