const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createFileStateStore } = require('../src/storage/file-state-store');

async function createTempFilePath() {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'time-tracker-storage-'));
  return path.join(tempDirectory, 'state.json');
}

test('load creates an empty state file when it does not exist', async () => {
  const filePath = await createTempFilePath();
  const store = createFileStateStore({ filePath });

  const state = await store.load();

  assert.deepEqual(state, {
    status: 'idle',
    activeEntry: null,
    sessions: []
  });

  const fileContents = await fs.readFile(filePath, 'utf8');
  assert.deepEqual(JSON.parse(fileContents), state);
});

test('save preserves state data on disk', async () => {
  const filePath = await createTempFilePath();
  const store = createFileStateStore({ filePath });
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-9',
      startAt: '2026-05-04T13:00:00.000Z'
    },
    sessions: [
      {
        id: 'PROJ-1:2026-05-04T09:00:00.000Z:2026-05-04T10:00:00.000Z',
        ticketId: 'PROJ-1',
        startAt: '2026-05-04T09:00:00.000Z',
        endAt: '2026-05-04T10:00:00.000Z',
        durationMs: 3600000,
        durationSeconds: 3600,
        synced: false,
        syncError: null
      }
    ]
  };

  await store.save(state);

  const reloadedState = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.deepEqual(reloadedState, state);
});

test('load normalizes legacy sessions into unsynced session records', async () => {
  const filePath = await createTempFilePath();
  await fs.writeFile(filePath, JSON.stringify({
    status: 'idle',
    activeEntry: null,
    sessions: [
      {
        ticketId: 'https://expondo.atlassian.net/browse/com-608',
        startAt: '2026-05-04T10:00:00.000Z',
        endAt: '2026-05-04T11:15:00.000Z',
        durationMs: 4500000
      }
    ]
  }, null, 2));
  const store = createFileStateStore({ filePath });

  const state = await store.load();

  assert.deepEqual(state.sessions, [
    {
      id: 'COM-608:2026-05-04T10:00:00.000Z:2026-05-04T11:15:00.000Z',
      ticketId: 'COM-608',
      startAt: '2026-05-04T10:00:00.000Z',
      endAt: '2026-05-04T11:15:00.000Z',
      durationMs: 4500000,
      durationSeconds: 4500,
      kind: 'work',
      synced: false,
      syncError: null
    }
  ]);
});

test('load defaults an invalid or missing session kind to "work" and preserves "review"', async () => {
  const filePath = await createTempFilePath();
  await fs.writeFile(filePath, JSON.stringify({
    status: 'idle',
    activeEntry: null,
    sessions: [
      {
        ticketId: 'COM-1',
        startAt: '2026-05-04T10:00:00.000Z',
        endAt: '2026-05-04T11:00:00.000Z',
        durationMs: 3600000,
        kind: 'review'
      },
      {
        ticketId: 'COM-2',
        startAt: '2026-05-04T11:00:00.000Z',
        endAt: '2026-05-04T12:00:00.000Z',
        durationMs: 3600000,
        kind: 'not-a-real-kind'
      }
    ]
  }, null, 2));
  const store = createFileStateStore({ filePath });

  const state = await store.load();

  assert.equal(state.sessions[0].kind, 'review');
  assert.equal(state.sessions[1].kind, 'work');
});

test('load normalizes a persisted active entry into a ticket ID', async () => {
  const filePath = await createTempFilePath();
  await fs.writeFile(filePath, JSON.stringify({
    status: 'working',
    activeEntry: {
      ticketId: 'https://expondo.atlassian.net/browse/com-609',
      startAt: '2026-05-04T12:00:00.000Z'
    },
    sessions: []
  }, null, 2));
  const store = createFileStateStore({ filePath });

  const state = await store.load();

  assert.deepEqual(state.activeEntry, {
    ticketId: 'COM-609',
    startAt: '2026-05-04T12:00:00.000Z',
    kind: 'work'
  });
});

test('load preserves a persisted "review" kind on the active entry', async () => {
  const filePath = await createTempFilePath();
  await fs.writeFile(filePath, JSON.stringify({
    status: 'working',
    activeEntry: {
      ticketId: 'COM-610',
      startAt: '2026-05-04T12:00:00.000Z',
      kind: 'review'
    },
    sessions: []
  }, null, 2));
  const store = createFileStateStore({ filePath });

  const state = await store.load();

  assert.equal(state.activeEntry.kind, 'review');
});