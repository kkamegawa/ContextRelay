import { strict as assert } from 'assert';
import { buildSearchSummary } from '../../panel/searchSummary';
import { ContextItem } from '../../models/contextItem';

function item(source: ContextItem['source'], title: string): ContextItem {
  return {
    source,
    title,
    snippet: `${title} snippet`,
    cache: { hit: false }
  };
}

suite('Search summary', () => {
  test('includes query, counts, and top titles', () => {
    const summary = buildSearchSummary('architecture review', [
      {
        source: 'mail',
        items: [item('mail', 'Mail one'), item('mail', 'Mail two')],
        cached: true
      },
      {
        source: 'teams',
        items: [item('teams', 'Teams thread')]
      }
    ]);

    assert.ok(summary.includes('Latest search query: `architecture review`'));
    assert.ok(summary.includes('Total results: 3'));
    assert.ok(summary.includes('Mail: 2 item(s) (cached). Top items: Mail one; Mail two.'));
    assert.ok(summary.includes('Teams: 1 item(s). Top items: Teams thread.'));
  });

  test('includes source errors', () => {
    const summary = buildSearchSummary('vpn', [
      {
        source: 'sharepoint',
        items: [],
        error: 'Authentication required'
      }
    ]);

    assert.ok(summary.includes('SharePoint: error — Authentication required'));
  });

  test('handles empty results', () => {
    const summary = buildSearchSummary('empty', []);
    assert.ok(summary.includes('No sources were queried.'));
  });
});