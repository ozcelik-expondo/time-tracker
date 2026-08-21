const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createFileStateStore } = require('../src/storage/file-state-store');
const { createTracker } = require('../src/tracker');

async function createTempFilePath() {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'time-tracker-tracker-'));
  return path.join(tempDirectory, 'state.json');
}

test('tracker normalizes ticket input: number, key, and URL', async () => {
  const filePath = await createTempFilePath();
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => '2026-05-04T12:00:00.000Z'
  });

  // Number only
  let state = await tracker.start('646');
  assert.equal(state.status, 'working');
  assert.deepEqual(state.activeEntry, {
    ticketId: 'COM-646',
    startAt: '2026-05-04T12:00:00.000Z',
    kind: 'work'
  });
  if (state.sessions.length > 0) {
    assert.equal(state.sessions[0].ticketId, 'COM-646');
    assert.equal(state.sessions[0].startAt, '2026-05-04T12:00:00.000Z');
  }

  // Key format
  await tracker.pause();
  state = await tracker.start('COM-646');
  assert.equal(state.status, 'working');
  assert.deepEqual(state.activeEntry, {
    ticketId: 'COM-646',
    startAt: '2026-05-04T12:00:00.000Z',
    kind: 'work'
  });
  if (state.sessions.length > 0) {
    assert.equal(state.sessions[0].ticketId, 'COM-646');
    assert.equal(state.sessions[0].startAt, '2026-05-04T12:00:00.000Z');
  }

  // URL format
  await tracker.pause();
  state = await tracker.start('https://expondo.atlassian.net/browse/COM-646');
  assert.equal(state.status, 'working');
  assert.deepEqual(state.activeEntry, {
    ticketId: 'COM-646',
    startAt: '2026-05-04T12:00:00.000Z',
    kind: 'work'
  });
  if (state.sessions.length > 0) {
    assert.equal(state.sessions[0].ticketId, 'COM-646');
    assert.equal(state.sessions[0].startAt, '2026-05-04T12:00:00.000Z');
  }
});

test('tracker persists sessions after commands', async () => {
  const filePath = await createTempFilePath();
  const times = [
    '2026-05-04T09:00:00.000Z',
    '2026-05-04T09:45:00.000Z'
  ];
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift()
  });

  await tracker.start('PROJ-1');
  await tracker.pause();

  const persistedState = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.deepEqual(persistedState.sessions, [
    {
      id: 'PROJ-1:2026-05-04T09:00:00.000Z:2026-05-04T09:45:00.000Z',
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      endAt: '2026-05-04T09:45:00.000Z',
      durationMs: 2700000,
      kind: 'work',
      durationSeconds: 2700,
      synced: false,
      syncError: null
    }
  ]);
  assert.equal(persistedState.status, 'idle');
  assert.equal(persistedState.activeEntry, null);
});

test('tracker restores an active session after reload', async () => {
  const filePath = await createTempFilePath();
  const store = createFileStateStore({ filePath });
  const firstTracker = createTracker({
    store,
    now: () => '2026-05-04T11:00:00.000Z'
  });

  await firstTracker.start('PROJ-7');

  const secondTracker = createTracker({
    store,
    now: () => '2026-05-04T11:30:00.000Z'
  });

  const state = await secondTracker.getState();

  assert.deepEqual(state, {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-7',
      startAt: '2026-05-04T11:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  });
});

test('tracker normalizes Jira browse URLs into ticket IDs', async () => {
  const filePath = await createTempFilePath();
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => '2026-05-04T11:00:00.000Z'
  });

  const state = await tracker.start('https://expondo.atlassian.net/browse/COM-608');

  assert.deepEqual(state, {
    status: 'working',
    activeEntry: {
      ticketId: 'COM-608',
      startAt: '2026-05-04T11:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  });
});

test('tracker does not close and reopen the same normalized active ticket', async () => {
  const filePath = await createTempFilePath();
  const times = [
    '2026-05-04T11:00:00.000Z',
    '2026-05-04T11:05:00.000Z'
  ];
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift()
  });

  await tracker.start('COM-608');
  const state = await tracker.switch('https://expondo.atlassian.net/browse/COM-608');

  assert.deepEqual(state, {
    status: 'working',
    activeEntry: {
      ticketId: 'COM-608',
      startAt: '2026-05-04T11:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  });
});

test('tracker treats starting a code review on the active ticket as a distinct entry', async () => {
  const filePath = await createTempFilePath();
  const times = [
    '2026-05-04T11:00:00.000Z',
    '2026-05-04T11:05:00.000Z'
  ];
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift()
  });

  await tracker.start('COM-608');
  const state = await tracker.switch('COM-608', 'review');

  assert.deepEqual(state.activeEntry, {
    ticketId: 'COM-608',
    startAt: '2026-05-04T11:05:00.000Z',
    kind: 'review'
  });
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].kind, 'work');
});

test('tracker pause stops an active code review the same way it stops ticket work', async () => {
  const filePath = await createTempFilePath();
  const times = [
    '2026-05-04T11:00:00.000Z',
    '2026-05-04T11:20:00.000Z'
  ];
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift()
  });

  await tracker.start('COM-608', 'review');
  const state = await tracker.pause();

  assert.equal(state.status, 'idle');
  assert.equal(state.activeEntry, null);
  assert.equal(state.sessions[0].kind, 'review');
});

test('tracker marks a completed session as synced when Jira worklog delivery succeeds', async () => {
  const filePath = await createTempFilePath();
  const sentSessions = [];
  const times = [
    '2026-05-04T09:00:00.000Z',
    '2026-05-04T09:30:00.000Z'
  ];
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift(),
    worklogSync: {
      isConfigured: true,
      async sendSession(session) {
        sentSessions.push(session);
      }
    }
  });

  await tracker.start('PROJ-5');
  const state = await tracker.pause();

  assert.equal(sentSessions.length, 1);
  assert.equal(sentSessions[0].ticketId, 'PROJ-5');
  assert.deepEqual(state.sessions, [
    {
      id: 'PROJ-5:2026-05-04T09:00:00.000Z:2026-05-04T09:30:00.000Z',
      ticketId: 'PROJ-5',
      startAt: '2026-05-04T09:00:00.000Z',
      endAt: '2026-05-04T09:30:00.000Z',
      durationMs: 1800000,
      kind: 'work',
      durationSeconds: 1800,
      synced: true,
      syncError: null
    }
  ]);
});

test('tracker preserves completed sessions when Jira worklog delivery fails', async () => {
  const filePath = await createTempFilePath();
  const times = [
    '2026-05-04T12:00:00.000Z',
    '2026-05-04T12:15:00.000Z'
  ];
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift(),
    worklogSync: {
      isConfigured: true,
      async sendSession() {
        throw new Error('Issue does not exist');
      }
    }
  });

  await tracker.start('PROJ-404');
  const state = await tracker.pause();

  assert.deepEqual(state.sessions, [
    {
      id: 'PROJ-404:2026-05-04T12:00:00.000Z:2026-05-04T12:15:00.000Z',
      ticketId: 'PROJ-404',
      startAt: '2026-05-04T12:00:00.000Z',
      endAt: '2026-05-04T12:15:00.000Z',
      durationMs: 900000,
      kind: 'work',
      durationSeconds: 900,
      synced: false,
      syncError: 'Issue does not exist'
    }
  ]);
});

test('tracker can retry unsynced sessions later', async () => {
  const filePath = await createTempFilePath();
  const times = [
    '2026-05-04T14:00:00.000Z',
    '2026-05-04T14:20:00.000Z'
  ];
  let shouldFail = true;
  const store = createFileStateStore({ filePath });
  const tracker = createTracker({
    store,
    now: () => times.shift(),
    worklogSync: {
      isConfigured: true,
      async sendSession() {
        if (shouldFail) {
          throw new Error('Temporary Jira outage');
        }
      }
    }
  });

  await tracker.start('PROJ-8');
  await tracker.pause();
  shouldFail = false;

  const state = await tracker.syncUnsyncedSessions();

  assert.deepEqual(state.sessions, [
    {
      id: 'PROJ-8:2026-05-04T14:00:00.000Z:2026-05-04T14:20:00.000Z',
      ticketId: 'PROJ-8',
      startAt: '2026-05-04T14:00:00.000Z',
      endAt: '2026-05-04T14:20:00.000Z',
      durationMs: 1200000,
      kind: 'work',
      durationSeconds: 1200,
      synced: true,
      syncError: null
    }
  ]);
});