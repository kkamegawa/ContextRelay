import { strict as assert } from 'assert';
import Module from 'module';

type SearchTodoFn = typeof import('../../adapters/todoAdapter').searchTodo;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let searchTodo: SearchTodoFn;

suite('To Do adapter', () => {
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
      ({ searchTodo } = await import('../../adapters/todoAdapter'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  test('returns personal task results with To Do metadata when requested', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v1.0/me/todo/lists/list-1/tasks?')) {
        return jsonResponse({
          value: [
            {
              id: 'todo-1',
              title: 'Buy groceries',
              status: 'notStarted',
              importance: 'high',
              categories: ['Errands'],
              createdDateTime: '2026-04-01T00:00:00Z',
              dueDateTime: {
                dateTime: '2026-04-30T00:00:00Z',
                timeZone: 'UTC'
              },
              body: {
                contentType: 'text',
                content: 'Need milk and fruit'
              }
            }
          ]
        });
      }

      if (url.endsWith('/v1.0/me/todo/lists')) {
        return jsonResponse({
          value: [
            {
              id: 'list-1',
              displayName: 'Personal',
              wellknownListName: 'defaultList'
            }
          ]
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    try {
      const items = await searchTodo('token', 'metadata groceries');

      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'todo');
      assert.equal(items[0].title, 'Buy groceries');
      assert.ok(items[0].snippet.includes('Need milk and fruit'));
      assert.ok(items[0].snippet.includes('List: Personal'));
        assert.ok(items[0].snippet.includes('Status: notStarted'));
        assert.ok(items[0].snippet.includes('Importance: high'));
        assert.ok(items[0].snippet.includes('Categories: Errands'));
        assert.deepEqual(items[0].raw, {
          body: 'Need milk and fruit',
          listName: 'Personal',
          wellknownListName: 'defaultList',
          status: 'notStarted',
          importance: 'high',
          categories: ['Errands']
        });
      } finally {
        globalThis.fetch = originalFetch;
    }
  });

  test('limits To Do list fan-out and task volume per query', async () => {
    const originalFetch = globalThis.fetch;
    let activeTaskRequests = 0;
    let maxActiveTaskRequests = 0;
    const fetchedListIds: string[] = [];
    const requestedTaskPageSizes: number[] = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/v1.0/me/todo/lists')) {
        return jsonResponse({
          value: Array.from({ length: 12 }, (_, index) => ({
            id: `list-${index + 1}`,
            displayName: `List ${index + 1}`
          }))
        });
      }

      const taskMatch = url.match(/\/v1\.0\/me\/todo\/lists\/([^/]+)\/tasks\?\$top=(\d+)/);
      if (taskMatch) {
        fetchedListIds.push(taskMatch[1]);
        requestedTaskPageSizes.push(Number(taskMatch[2]));
        activeTaskRequests += 1;
        maxActiveTaskRequests = Math.max(maxActiveTaskRequests, activeTaskRequests);
        await Promise.resolve();
        activeTaskRequests -= 1;
        return jsonResponse({
          value: [
            {
              id: `todo-${taskMatch[1]}`,
              title: `Groceries ${taskMatch[1]}`,
              createdDateTime: '2026-04-01T00:00:00Z',
              body: {
                contentType: 'text',
                content: 'groceries metadata'
              }
            }
          ]
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    try {
      const items = await searchTodo('token', 'metadata groceries');

      assert.equal(items.length, 8);
      assert.equal(fetchedListIds.length, 8);
      assert.deepEqual(fetchedListIds, [
        'list-1',
        'list-2',
        'list-3',
        'list-4',
        'list-5',
        'list-6',
        'list-7',
        'list-8'
      ]);
      assert.deepEqual(requestedTaskPageSizes, Array(8).fill(10));
      assert.equal(maxActiveTaskRequests, 4);
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
