import { strict as assert } from 'assert';
import Module from 'module';

type SearchOneNoteFn = typeof import('../../adapters/onenoteAdapter').searchOneNote;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let searchOneNote: SearchOneNoteFn;

suite('OneNote adapter', () => {
  suiteSetup(async () => {
    moduleLoader._load = (request: string, parent: object | null | undefined, isMain: boolean): unknown => {
      if (request === 'vscode') {
        return {
          workspace: {
            getConfiguration: () => ({
              get: <T>(_key: string, defaultValue: T): T => defaultValue
            })
          }
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      ({ searchOneNote } = await import('../../adapters/onenoteAdapter'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  test('returns page-oriented results and includes hierarchy when explicitly requested', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v1.0/me/onenote/pages?')) {
        assert.ok(url.includes('parentSection($select=id,displayName)'));
        assert.ok(url.includes('parentNotebook($select=id,displayName)'));
        return jsonResponse({
          value: [
            {
              id: 'page-1',
              title: 'Architecture decision log',
              lastModifiedDateTime: '2026-04-01T00:00:00Z',
              contentUrl: 'https://graph.microsoft.com/v1.0/me/onenote/pages/page-1/content',
              links: { oneNoteWebUrl: { href: 'https://example.com/onenote/page-1' } },
              parentSection: { displayName: 'Architecture' },
              parentNotebook: { displayName: 'Engineering wiki' }
            },
            {
              id: 'page-2',
              title: 'Random page',
              lastModifiedDateTime: '2026-03-01T00:00:00Z',
              links: { oneNoteWebUrl: { href: 'https://example.com/onenote/page-2' } },
              parentSection: { displayName: 'General' },
              parentNotebook: { displayName: 'Misc' }
            }
          ]
        });
      }

      if (url.includes('/v1.0/me/onenote/pages/page-1/preview')) {
        return jsonResponse({ previewText: 'Architecture review notes and action items.' });
      }

      if (url.includes('/v1.0/me/onenote/pages/page-2/preview')) {
        return jsonResponse({ previewText: 'Unrelated content.' });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    try {
      const items = await searchOneNote('token', 'section notebook architecture');

      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'onenote');
      assert.equal(items[0].title, 'Architecture decision log');
      assert.ok(items[0].snippet.includes('Architecture · Engineering wiki'));
      assert.ok(items[0].snippet.includes('Architecture review notes'));
      assert.equal(items[0].url, 'https://example.com/onenote/page-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
