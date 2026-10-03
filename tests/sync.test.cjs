// Run with: node --test tests/sync.test.cjs
// Uses isolated in-memory storage and mocked Drive responses; no customer data or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const epoch = '1970-01-01T00:00:00Z';
const stamp = '2026-10-01T00:00:00Z';

function harness(records = [], saved = {}) {
  const storage = new Map(Object.entries(saved));
  const pledges = new Map(records.map((p, i) => [p.id || i + 1, { ...copy(p), id: p.id || i + 1 }]));
  let nextId = Math.max(0, ...pledges.keys()) + 1;
  const settingsStore = new Map();
  const writes = [];
  const queries = [];
  const files = [];
  const remote = new Map();
  const hooks = {};
  const context = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob,
    crypto: { randomUUID }, navigator: { onLine: true },
    window: { crypto: { randomUUID } },
    document: { addEventListener() {}, querySelector() { return { classList: { contains() { return false; } } }; } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) }
  });
  const expose = `
    globalThis.api = {
      pullChanges, migrateOnce, pushDirty, drivePutPledge, drivePutSettings, driveListAll, queueSync, performSync,
      state: () => ({ settings, driveFileMap, lastPullAt, syncing }),
      configure: function (deps, initialSettings) {
        dbAll = deps.dbAll; dbGet = deps.dbGet; dbPut = deps.dbPut; dbDel = deps.dbDel;
        driveListAll = deps.list; driveDownloadJSON = deps.download; driveUploadJSON = deps.upload;
        driveFindFolderByName = deps.folder; driveFindInFolder = deps.find;
        settings = Object.assign({}, DEFAULT_SETTINGS, initialSettings);
        driveDataFolderId = 'test-folder';
        applySettingsToBar = function () {}; showHome = async function () {};
        setSyncStatus = function () {}; whenGisReady = async function () { return true; };
        initGoogle = function () {}; getAccessToken = async function () { return 'test-token'; };
        ensureDataFolder = async function () { return 'test-folder'; };
      },
      setDriveFetch: fn => { driveFetch = fn; },
      editSettings: patch => Object.assign(settings, patch)
    };
  `;
  vm.runInContext(source.replace("document.addEventListener('DOMContentLoaded', init);", expose), context);
  const api = context.api;
  api.configure({
    dbAll: async store => copy(Array.from((store === 'pledges' ? pledges : settingsStore).values())),
    dbGet: async (store, key) => copy((store === 'pledges' ? pledges : settingsStore).get(key)),
    dbPut: async (store, value) => {
      if (hooks.put) await hooks.put(store, value);
      const record = copy(value); const key = store === 'pledges' ? (record.id || nextId++) : record.key;
      if (store === 'pledges') record.id = key;
      (store === 'pledges' ? pledges : settingsStore).set(key, record); return key;
    },
    dbDel: async (store, key) => (store === 'pledges' ? pledges : settingsStore).delete(key),
    list: async query => { queries.push(query); return hooks.list ? hooks.list(query) : copy(files); },
    download: async id => hooks.download ? hooks.download(id) : copy(remote.get(id)),
    upload: async (...args) => { writes.push(args); if (hooks.upload) return hooks.upload(...args); return { id: args[2] || 'created-' + writes.length, modifiedTime: '2026-10-03T00:00:00Z' }; },
    folder: async name => hooks.folder ? hooks.folder(name) : null,
    find: async (folder, name) => hooks.find ? hooks.find(folder, name) : (name === 'settings.json' ? null : { id: 'legacy-file' })
  }, {});
  return { api, storage, pledges, settingsStore, files, remote, writes, queries, hooks };
}
function add(h, uid, record = {}, modifiedTime = stamp) {
  h.files.push({ id: uid, name: 'pledge-' + uid + '.json', modifiedTime });
  h.remote.set(uid, { uid, updatedAt: 20, customerPhoto: 'data:customer', articlePhoto: 'data:ornament', ...record });
}

test('first updated sync recovers ALL records despite an old advanced checkpoint and is idempotent', async () => {
  const h = harness([{ uid: 'existing', updatedAt: 10, pendingPush: false }], { ga_lastPull: '2026-10-03T00:00:00Z', ga_migratedV3: '1' });
  add(h, 'existing'); add(h, 'old-remote', { updatedAt: 1 }, '2026-01-01T00:00:00Z');
  await h.api.pullChanges();
  assert.match(h.queries[0], /1970-01-01/);
  assert.equal(h.pledges.size, 2);
  assert.equal(h.pledges.get(1).customerPhoto, 'data:customer');
  assert.equal(h.storage.get('ga_restoreV1'), '1');
  assert.equal(h.storage.get('ga_lastPull'), stamp);
  await h.api.pullChanges();
  assert.equal(h.pledges.size, 2);
  assert.match(h.queries[1], /2026-09-30T23:59:59/);
});

test('failed downloads retain the checkpoint and retry missing records without duplicates', async () => {
  const h = harness([], { ga_lastPull: '2026-09-01T00:00:00Z' }); add(h, 'one'); add(h, 'two');
  h.hooks.download = async id => { if (id === 'two') throw new Error('network'); return copy(h.remote.get(id)); };
  await assert.rejects(h.api.pullChanges(), /network/);
  assert.equal(h.storage.get('ga_restoreV1'), undefined);
  assert.equal(h.storage.get('ga_lastPull'), '2026-09-01T00:00:00Z');
  h.hooks.download = null; await h.api.pullChanges(); assert.equal(h.pledges.size, 2);
});

test('listing failures and malformed records do not report a completed restore', async () => {
  const h = harness(); h.hooks.list = async () => { throw new Error('offline'); };
  await assert.rejects(h.api.pullChanges(), /offline/); assert.equal(h.storage.get('ga_restoreV1'), undefined);
  h.hooks.list = null; add(h, 'bad'); h.remote.set('bad', {});
  await assert.rejects(h.api.pullChanges(), /invalid-pledge/); assert.equal(h.storage.get('ga_restoreV1'), undefined);
});

test('edits made during download remain intact, including photos and pending saves', async () => {
  const h = harness([{ uid: 'one', updatedAt: 1, pendingPush: false }]); add(h, 'one', { updatedAt: 999 });
  h.hooks.download = async id => {
    h.pledges.set(1, { id: 1, uid: 'one', updatedAt: 2, pendingPush: true, customerPhoto: 'new-local-photo' });
    return copy(h.remote.get(id));
  };
  await h.api.pullChanges(); assert.equal(h.pledges.get(1).customerPhoto, 'new-local-photo'); assert.equal(h.pledges.get(1).pendingPush, true);
});

test('Drive deletions apply to clean records but preserve unsynced local edits', async () => {
  const h = harness([{ uid: 'clean', updatedAt: 1 }, { uid: 'dirty', updatedAt: 1, pendingPush: true }]);
  add(h, 'clean', { deleted: true }); add(h, 'dirty', { deleted: true });
  await h.api.pullChanges(); assert.equal(h.pledges.size, 1); assert.equal(h.pledges.get(2).uid, 'dirty');
});

test('restored shop settings are clean, not re-uploaded because of a remote pending flag', async () => {
  const h = harness(); h.files.push({ id: 'settings', name: 'settings.json', modifiedTime: stamp });
  h.remote.set('settings', { shopName: 'Existing shop', updatedAt: 10, pendingPush: true });
  await h.api.pullChanges(); assert.equal(h.api.state().settings.shopName, 'Existing shop'); assert.equal(h.api.state().settings.pendingPush, false);
});

test('uploads never advance the download checkpoint or recreate known Drive files', async () => {
  const h = harness(); add(h, 'one'); await h.api.pullChanges();
  const before = h.api.state().lastPullAt;
  await h.api.drivePutPledge({ uid: 'one', customerPhoto: 'existing-photo' });
  await h.api.drivePutSettings();
  assert.equal(h.api.state().lastPullAt, before); assert.equal(h.writes[0][2], 'one');
});

test('legacy backups merge with a partial local cache and respect current Drive deletion files', async () => {
  const h = harness([{ uid: 'local', updatedAt: 10, pendingPush: true, customerPhoto: 'local-photo' }], { ga_migratedV3: '1' });
  add(h, 'deleted', { deleted: true });
  h.hooks.folder = async name => name === 'Pledge Book - Backups' ? { id: 'legacy-folder' } : null;
  h.remote.set('legacy-file', { pledges: [{ uid: 'local', updatedAt: 1 }, { uid: 'missing', updatedAt: 2, articlePhoto: 'old-photo' }, { uid: 'deleted', updatedAt: 1 }], settings: { shopName: 'Old shop', updatedAt: 2 } });
  await h.api.migrateOnce(); assert.equal(h.pledges.size, 2);
  assert.equal(h.pledges.get(1).customerPhoto, 'local-photo');
  assert.equal(Array.from(h.pledges.values()).find(p => p.uid === 'missing').articlePhoto, 'old-photo');
  assert.equal(h.storage.get('ga_migratedV4'), '1');
  await h.api.migrateOnce(); assert.equal(h.pledges.size, 2);
});

test('legacy records without sync IDs remain distinct and retry without duplication', async () => {
  const h = harness(); h.hooks.folder = async name => name === 'Pledge Book - Backups' ? { id: 'old' } : null;
  h.remote.set('legacy-file', { pledges: [{ id: 21, pledgeNo: 21, articlePhoto: 'a' }, { id: 22, pledgeNo: 22, customerPhoto: 'b' }] });
  let failed = false;
  h.hooks.put = async (store, p) => { if (!failed && p.pledgeNo === 22) { failed = true; throw new Error('storage-error'); } };
  await assert.rejects(h.api.migrateOnce(), /storage-error/); assert.equal(h.storage.get('ga_migratedV4'), undefined);
  await h.api.migrateOnce(); assert.equal(h.pledges.size, 2); assert.equal(new Set(Array.from(h.pledges.values()).map(p => p.uid)).size, 2);
  assert.ok(Array.from(h.pledges.values()).every(p => p.updatedAt && p.pendingPush));
});

test('migration failures leave the original records and migration marker untouched', async () => {
  const h = harness([{ uid: 'local', customerPhoto: 'unchanged' }]);
  h.hooks.list = async () => { throw new Error('drive-503'); };
  await assert.rejects(h.api.migrateOnce(), /drive-503/);
  assert.equal(h.pledges.get(1).customerPhoto, 'unchanged'); assert.equal(h.storage.get('ga_migratedV4'), undefined);
});

test('current Drive shop settings take precedence over a legacy backup on a new device', async () => {
  const h = harness();
  h.hooks.find = async (folder, name) => ({ id: name === 'settings.json' ? 'current-settings' : 'legacy-file' });
  h.hooks.folder = async name => name === 'Pledge Book - Backups' ? { id: 'old-folder' } : null;
  h.remote.set('legacy-file', { pledges: [], settings: { shopName: 'Outdated', updatedAt: 1 } });
  h.files.push({ id: 'current-settings', name: 'settings.json', modifiedTime: stamp });
  h.remote.set('current-settings', { shopName: 'Current', updatedAt: 2 });
  await h.api.migrateOnce(); await h.api.pullChanges(); await h.api.pushDirty();
  assert.equal(h.api.state().settings.shopName, 'Current'); assert.equal(h.writes.length, 0);
});

test('settings edited during upload retain their pending flag for the next save', async () => {
  const h = harness(); h.api.editSettings({ updatedAt: 1, pendingPush: true });
  h.hooks.upload = async () => { h.api.editSettings({ updatedAt: 2, shopName: 'Edited during upload' }); return { id: 'settings' }; };
  await h.api.pushDirty(); assert.equal(h.api.state().settings.pendingPush, true); assert.equal(h.api.state().settings.shopName, 'Edited during upload');
});

test('sync jobs serialize and later jobs still run after a failure', async () => {
  const h = harness(); const events = []; let release;
  const gate = new Promise(r => { release = r; });
  const first = h.api.queueSync(async () => { events.push('first'); await gate; throw new Error('retry'); });
  const second = h.api.queueSync(async () => { events.push('second'); });
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(events, ['first']); assert.equal(h.api.state().syncing, true);
  release(); await assert.rejects(first, /retry/); await second;
  assert.deepEqual(events, ['first', 'second']); assert.equal(h.api.state().syncing, false);
});

test('Drive listing follows every page', async () => {
  const h = harness(); const urls = [];
  h.api.setDriveFetch(async url => { urls.push(url); return { json: async () => urls.length === 1 ? { files: [{ id: 'one' }], nextPageToken: 'next' } : { files: [{ id: 'two' }] } }; });
  const all = await h.api.driveListAll('test-query'); assert.equal(all.length, 2); assert.match(urls[1], /pageToken=next/);
});

test('the standard startup sync restores before saving and works on all old pledges', async () => {
  const h = harness([{ uid: 'local', updatedAt: 1, pendingPush: true, articlePhoto: 'local-item' }], { ga_migratedV4: '1', ga_lastPull: '2026-10-03T00:00:00Z' });
  add(h, 'local', { updatedAt: 1 }); add(h, 'remote-old', { customerPhoto: 'old-customer' }, '2025-01-01T00:00:00Z');
  await h.api.performSync(); assert.equal(h.pledges.size, 2); assert.equal(h.writes[0][2], 'local');
  assert.equal(h.pledges.get(1).pendingPush, false); assert.equal(h.storage.get('ga_restoreV1'), '1');
});
