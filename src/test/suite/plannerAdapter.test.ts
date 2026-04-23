import { strict as assert } from 'assert';
import Module from 'module';

type SearchPlannerFn = typeof import('../../adapters/plannerAdapter').searchPlanner;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let searchPlanner: SearchPlannerFn;

suite('Planner adapter', () => {
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
      ({ searchPlanner } = await import('../../adapters/plannerAdapter'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  test('returns task-oriented results and enriches metadata/comment notes on explicit request', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v1.0/me/planner/tasks?')) {
        return jsonResponse({
          value: [
            {
              id: 'task-1',
              title: 'Onboarding checklist',
              planId: 'plan-1',
              bucketId: 'bucket-1',
              conversationThreadId: 'thread-1',
              percentComplete: 50,
              hasDescription: true,
              dueDateTime: '2026-05-01T00:00:00Z'
            }
          ]
        });
      }

      if (url.includes('/v1.0/planner/tasks/task-1/details')) {
        return jsonResponse({
          description: 'Prepare onboarding tasks for the next release.',
          checklist: {
            one: { title: 'Create accounts' },
            two: { title: 'Schedule walkthrough' }
          }
        });
      }

      if (url.includes('/v1.0/planner/plans/plan-1')) {
        return jsonResponse({ id: 'plan-1', title: 'Release train' });
      }

      if (url.includes('/v1.0/planner/buckets/bucket-1')) {
        return jsonResponse({ id: 'bucket-1', name: 'Ready' });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    try {
      const items = await searchPlanner('token', 'metadata comments onboarding');

      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'planner');
      assert.equal(items[0].title, 'Onboarding checklist');
      assert.ok(items[0].snippet.includes('Prepare onboarding tasks'));
      assert.ok(items[0].snippet.includes('Plan: Release train'));
      assert.ok(items[0].snippet.includes('Bucket: Ready'));
      assert.ok(items[0].snippet.includes('Checklist: Create accounts; Schedule walkthrough'));
      assert.ok(items[0].snippet.includes('additional Microsoft 365 group conversation permissions'));
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
