import { strict as assert } from 'assert';
import { getEnabledEmbeddedSources, validateEmbeddedSources } from '../../embedded/embeddedSources';
import { canOpenResult } from '../../models/contextItem';

suite('SharePoint Embedded sources', () => {
  test('returns enabled sources with trimmed names and IDs in configured order', () => {
    const sources = getEnabledEmbeddedSources([
      { name: '  Project knowledge  ', containerTypeId: ' 11111111-2222-4333-8444-555555555555 ', enabled: true },
      { name: 'Disabled', containerTypeId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', enabled: false }
    ]);

    assert.deepEqual(sources, [{
      name: 'Project knowledge',
      containerTypeId: '11111111-2222-4333-8444-555555555555',
      enabled: true
    }]);
  });

  test('ignores disabled rows without requiring their unused values to be valid', () => {
    assert.deepEqual(getEnabledEmbeddedSources([
      { name: 'Disabled bad ID', containerTypeId: 'not-a-guid', enabled: false }
    ]), []);
    assert.deepEqual(getEnabledEmbeddedSources(undefined), []);
  });

  test('rejects malformed enabled rows and duplicate names or container type IDs', () => {
    assert.throws(() => validateEmbeddedSources('not an array'), /must be configured as a list/);
    assert.throws(() => getEnabledEmbeddedSources([null]), /must be an object/);
    assert.throws(() => getEnabledEmbeddedSources([{ name: 'Missing enabled', containerTypeId: '11111111-2222-4333-8444-555555555555' }]), /must set enabled/);
    assert.throws(() => getEnabledEmbeddedSources([{ name: '  ', containerTypeId: '11111111-2222-4333-8444-555555555555', enabled: true }]), /non-empty name/);
    assert.throws(() => getEnabledEmbeddedSources([{ name: 'Bad ID', containerTypeId: 'not-a-guid', enabled: true }]), /valid container type GUID/);
    assert.throws(() => getEnabledEmbeddedSources([
      { name: 'Knowledge', containerTypeId: '11111111-2222-4333-8444-555555555555', enabled: true },
      { name: 'knowledge', containerTypeId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', enabled: true }
    ]), /name .* is duplicated/);
    assert.throws(() => getEnabledEmbeddedSources([
      { name: 'First', containerTypeId: '11111111-2222-4333-8444-555555555555', enabled: true },
      { name: 'Second', containerTypeId: '11111111-2222-4333-8444-555555555555', enabled: true }
    ]), /container type ID .* is duplicated/);
  });

  test('allows an Embedded extract to open in an internal preview without a web URL', () => {
    assert.equal(canOpenResult({ source: 'sharepoint-embedded' }), true);
  });
});
