import { strict as assert } from 'assert';
import Module from 'module';
import { buildSearchSnippet, escapeODataString, formatLocationSnippet, isOneDriveUrl, stripSearchMarkup } from '../../adapters/retrievalSearchUtils';

type SearchRetrievalFn = typeof import('../../adapters/retrievalAdapter').searchRetrieval;
type SearchEmbeddedFn = typeof import('../../adapters/retrievalAdapter').searchEmbedded;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let searchRetrieval: SearchRetrievalFn;
let searchEmbedded: SearchEmbeddedFn;

suite('Retrieval adapter', () => {
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
      ({ searchRetrieval, searchEmbedded } = await import('../../adapters/retrievalAdapter'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  test('escapes single quotes for OData search', () => {
    assert.equal(escapeODataString("O'Brien plan"), "O''Brien plan");
  });

  test('detects OneDrive personal site URLs', () => {
    assert.equal(
      isOneDriveUrl('https://contoso-my.sharepoint.com/personal/user_contoso_com/Documents/file.docx'),
      true
    );
    assert.equal(
      isOneDriveUrl('https://contoso.sharepoint.com/sites/engineering/Shared%20Documents/spec.docx'),
      false
    );
  });

  test('rejects crafted or incomplete OneDrive-looking URLs', () => {
    assert.equal(
      isOneDriveUrl('https://contoso-my.sharepoint.com.attacker.test/personal/user_contoso_com/Documents/file.docx'),
      false
    );
    assert.equal(
      isOneDriveUrl('https://example.test/personal/user_contoso_com/Documents/file.docx'),
      false
    );
    assert.equal(
      isOneDriveUrl('https://contoso-my.sharepoint.com/sites/group/Documents/file.docx'),
      false
    );
    assert.equal(
      isOneDriveUrl('http://contoso-my.sharepoint.com/personal/user_contoso_com/Documents/file.docx'),
      false
    );
  });

  test('removes search highlight markup from summaries', () => {
    assert.equal(stripSearchMarkup('<c0>Project</c0> plan <ddd/> preview'), 'Project plan … preview');
  });

  test('prefers search summary for preview snippet', () => {
    assert.equal(
      buildSearchSnippet('<c0>Architecture</c0> review <ddd/> excerpt', undefined, 'https://contoso-my.sharepoint.com/personal/user/Documents/file.docx'),
      'Architecture review … excerpt'
    );
  });

  test('formats raw OneDrive URLs as concise location snippets', () => {
    assert.equal(
      formatLocationSnippet(
        undefined,
        'https://contoso-my.sharepoint.com/personal/user_contoso_com/Documents/%E8%B3%87%E6%96%99/Reference/Notes'
      ),
      '資料 / Reference / Notes'
    );
  });

  test('does not use raw OneDrive personal location strings as snippets', () => {
    assert.equal(
      buildSearchSnippet(
        undefined,
        'contoso-my.sharepoint.com/personal/user_contoso_com/Documents/%E8%B3%87%E6%96%99/Reference/Notes',
        'https://contoso-my.sharepoint.com/personal/user_contoso_com/Documents/%E8%B3%87%E6%96%99/Reference/Notes'
      ),
      '資料 / Reference / Notes'
    );
  });

  test('does not use raw SharePoint site location strings as snippets', () => {
    assert.equal(
      buildSearchSnippet(
        undefined,
        'contoso.sharepoint.com/sites/engineering/Shared%20Documents/specs/Architecture',
        'https://contoso.sharepoint.com/sites/engineering/Shared%20Documents/specs/Architecture'
      ),
      'specs / Architecture'
    );
  });

  test('externalItem retrieval sends Graph-compliant request body and parses retrievalHits', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedInit = init;
      const responseBody = {
        retrievalHits: [
          {
            webUrl: 'https://example.com/doc/1',
            extracts: [{ text: 'First extract' }, { text: 'Second extract' }],
            resourceMetadata: { title: 'Connector Document' },
            resourceType: 'externalItem'
          }
        ]
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    try {
      const items = await searchRetrieval('token', 'translate this mail please', 'externalItem');

      assert.equal(capturedUrl, 'https://graph.microsoft.com/v1.0/copilot/retrieval');
      assert.equal(capturedInit?.method, 'POST');

      const body = JSON.parse(capturedInit?.body as string);
      assert.equal(body.queryString, 'translate this mail please');
      assert.equal(body.dataSource, 'externalItem');
      assert.equal(typeof body.maximumNumberOfResults, 'number');
      assert.ok(body.maximumNumberOfResults >= 1 && body.maximumNumberOfResults <= 25);
      // The earlier, buggy shape wrapped the query and used `size`, which Graph rejects with HTTP 400.
      assert.equal(body.query, undefined, 'queryString must be top-level, not nested under "query"');
      assert.equal(body.size, undefined, 'must use maximumNumberOfResults, not "size"');

      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'connectors');
      assert.equal(items[0].title, 'Connector Document');
      assert.equal(items[0].url, 'https://example.com/doc/1');
      assert.equal(items[0].snippet, 'First extract Second extract');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('externalItem retrieval truncates queryString at 1500 chars to avoid Graph 400', async () => {
    const originalFetch = globalThis.fetch;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      capturedInit = init;
      return new Response(JSON.stringify({ retrievalHits: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    try {
      const longQuery = 'a'.repeat(2000);
      await searchRetrieval('token', longQuery, 'externalItem');

      const body = JSON.parse(capturedInit?.body as string);
      assert.equal(body.queryString.length, 1500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('SharePoint Embedded retrieval sends container configuration and preserves extracts and scores', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedInit = init;
      return new Response(JSON.stringify({
        retrievalHits: [{
          webUrl: 'https://example.com/loop/page',
          sensitivityLabel: { id: 'label-id' },
          resourceType: 'file',
          resourceMetadata: { title: 'Architecture notes' },
          extracts: [
            { text: 'First grounded paragraph', relevanceScore: 0.93 },
            { text: 'Second grounded paragraph', relevanceScore: 0.81 }
          ]
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const items = await searchEmbedded('token', '  authentication design  ', {
        name: 'Project knowledge',
        containerTypeId: '11111111-2222-4333-8444-555555555555',
        enabled: true
      });

      assert.equal(capturedUrl, 'https://graph.microsoft.com/v1.0/copilot/retrieval');
      assert.equal(capturedInit?.method, 'POST');
      const body = JSON.parse(capturedInit?.body as string);
      assert.equal(body.queryString, 'authentication design');
      assert.equal(body.dataSource, 'sharePointEmbedded');
      assert.deepEqual(body.dataSourceConfiguration, {
        sharePointEmbedded: { containerTypeId: '11111111-2222-4333-8444-555555555555' }
      });
      assert.ok(body.maximumNumberOfResults >= 1 && body.maximumNumberOfResults <= 25);
      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'sharepoint-embedded');
      assert.equal(items[0].title, 'Architecture notes');
      assert.equal(items[0].snippet, 'First grounded paragraph Second grounded paragraph');
      assert.deepEqual(items[0].raw, {
        sourceName: 'Project knowledge',
        containerTypeId: '11111111-2222-4333-8444-555555555555',
        extracts: ['First grounded paragraph', 'Second grounded paragraph'],
        resourceType: 'file',
        extractRelevanceScores: [0.93, 0.81],
        sensitivityLabel: { id: 'label-id' }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('SharePoint Embedded retrieval rejects empty and overlong queries before calling Graph', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async (): Promise<Response> => {
      fetchCount++;
      return new Response(JSON.stringify({ retrievalHits: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const source = {
        name: 'Project knowledge',
        containerTypeId: '11111111-2222-4333-8444-555555555555',
        enabled: true
      };
      await assert.rejects(searchEmbedded('token', ' \n ', source), /must not be empty/);
      await assert.rejects(searchEmbedded('token', 'a'.repeat(1501), source), /1500 characters or fewer/);
      await assert.rejects(searchEmbedded('token', 'query', { ...source, enabled: false }), /source is disabled/);
      await assert.rejects(searchEmbedded('token', 'query', { ...source, name: '  ' }), /source name is required/);
      assert.equal(fetchCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
