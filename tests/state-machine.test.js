const test = require('node:test');
const assert = require('node:assert/strict');

const { createInitialState, applyCommand } = require('../src/domain/state-machine');

test('switch closes the previous ticket session and starts the new ticket', () => {
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  };

  const nextState = applyCommand(state, {
    type: 'switch',
    ticketId: 'PROJ-2',
    at: '2026-05-04T09:30:00.000Z'
  });

  assert.deepEqual(nextState, {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-2',
      startAt: '2026-05-04T09:30:00.000Z',
      kind: 'work'
    },
    sessions: [
      {
        ticketId: 'PROJ-1',
        startAt: '2026-05-04T09:00:00.000Z',
        endAt: '2026-05-04T09:30:00.000Z',
        durationMs: 1800000,
        kind: 'work'
      }
    ]
  });
});

test('switch can start a code review while defaulting the kind to work', () => {
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  };

  const nextState = applyCommand(state, {
    type: 'switch',
    ticketId: 'PROJ-2',
    kind: 'review',
    at: '2026-05-04T09:30:00.000Z'
  });

  assert.deepEqual(nextState.activeEntry, {
    ticketId: 'PROJ-2',
    startAt: '2026-05-04T09:30:00.000Z',
    kind: 'review'
  });
  assert.equal(nextState.sessions[0].kind, 'work');
});

test('pause ends the active session and moves the tracker to idle', () => {
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  };

  const nextState = applyCommand(state, {
    type: 'pause',
    at: '2026-05-04T09:10:00.000Z'
  });

  assert.deepEqual(nextState, {
    status: 'idle',
    activeEntry: null,
    sessions: [
      {
        ticketId: 'PROJ-1',
        startAt: '2026-05-04T09:00:00.000Z',
        endAt: '2026-05-04T09:10:00.000Z',
        durationMs: 600000,
        kind: 'work'
      }
    ]
  });
});

test('pause ends an active code review the same way it ends ticket work', () => {
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      kind: 'review'
    },
    sessions: []
  };

  const nextState = applyCommand(state, {
    type: 'pause',
    at: '2026-05-04T09:10:00.000Z'
  });

  assert.deepEqual(nextState, {
    status: 'idle',
    activeEntry: null,
    sessions: [
      {
        ticketId: 'PROJ-1',
        startAt: '2026-05-04T09:00:00.000Z',
        endAt: '2026-05-04T09:10:00.000Z',
        durationMs: 600000,
        kind: 'review'
      }
    ]
  });
});

test('pause while idle leaves state unchanged', () => {
  const state = createInitialState();

  const nextState = applyCommand(state, {
    type: 'pause',
    at: '2026-05-04T09:10:00.000Z'
  });

  assert.deepEqual(nextState, state);
});

test('switch while idle starts a new active ticket', () => {
  const nextState = applyCommand(createInitialState(), {
    type: 'switch',
    ticketId: 'PROJ-2',
    at: '2026-05-04T09:30:00.000Z'
  });

  assert.deepEqual(nextState, {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-2',
      startAt: '2026-05-04T09:30:00.000Z',
      kind: 'work'
    },
    sessions: []
  });
});

test('switch while idle can start a code review directly', () => {
  const nextState = applyCommand(createInitialState(), {
    type: 'switch',
    ticketId: 'PROJ-2',
    kind: 'review',
    at: '2026-05-04T09:30:00.000Z'
  });

  assert.deepEqual(nextState, {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-2',
      startAt: '2026-05-04T09:30:00.000Z',
      kind: 'review'
    },
    sessions: []
  });
});

test('punchOut ends the active session and clears activity', () => {
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  };

  const nextState = applyCommand(state, {
    type: 'punchOut',
    at: '2026-05-04T09:45:00.000Z'
  });

  assert.equal(nextState.status, 'idle');
  assert.equal(nextState.activeEntry, null);
  assert.deepEqual(nextState.sessions, [
    {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      endAt: '2026-05-04T09:45:00.000Z',
      durationMs: 2700000,
      kind: 'work'
    }
  ]);
});

test('punchOut while idle leaves state unchanged', () => {
  const state = createInitialState();

  const nextState = applyCommand(state, {
    type: 'punchOut',
    at: '2026-05-04T09:45:00.000Z'
  });

  assert.deepEqual(nextState, state);
});

test('start behaves like switch when a ticket is already active', () => {
  const state = {
    status: 'working',
    activeEntry: {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      kind: 'work'
    },
    sessions: []
  };

  const nextState = applyCommand(state, {
    type: 'start',
    ticketId: 'PROJ-2',
    at: '2026-05-04T09:20:00.000Z'
  });

  assert.equal(nextState.status, 'working');
  assert.deepEqual(nextState.activeEntry, {
    ticketId: 'PROJ-2',
    startAt: '2026-05-04T09:20:00.000Z',
    kind: 'work'
  });
  assert.deepEqual(nextState.sessions, [
    {
      ticketId: 'PROJ-1',
      startAt: '2026-05-04T09:00:00.000Z',
      endAt: '2026-05-04T09:20:00.000Z',
      durationMs: 1200000,
      kind: 'work'
    }
  ]);
});
