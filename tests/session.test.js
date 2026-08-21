const test = require('node:test');
const assert = require('node:assert/strict');

const { createSession, getDurationInMilliseconds } = require('../src/domain/session');

test('createSession returns the expected session shape', () => {
  const session = createSession({
    ticketId: 'PROJ-123',
    startAt: '2026-05-04T09:00:00.000Z',
    endAt: '2026-05-04T09:30:00.000Z'
  });

  assert.deepEqual(session, {
    ticketId: 'PROJ-123',
    startAt: '2026-05-04T09:00:00.000Z',
    endAt: '2026-05-04T09:30:00.000Z',
    durationMs: 1800000,
    kind: 'work'
  });
});

test('createSession defaults to a "work" kind and preserves an explicit "review" kind', () => {
  const workSession = createSession({
    ticketId: 'PROJ-123',
    startAt: '2026-05-04T09:00:00.000Z',
    endAt: '2026-05-04T09:30:00.000Z'
  });

  assert.equal(workSession.kind, 'work');

  const reviewSession = createSession({
    ticketId: 'PROJ-123',
    startAt: '2026-05-04T09:00:00.000Z',
    endAt: '2026-05-04T09:30:00.000Z',
    kind: 'review'
  });

  assert.equal(reviewSession.kind, 'review');
});

test('getDurationInMilliseconds computes the duration between timestamps', () => {
  const durationMs = getDurationInMilliseconds(
    '2026-05-04T09:00:00.000Z',
    '2026-05-04T11:15:30.000Z'
  );

  assert.equal(durationMs, 8130000);
});

test('createSession rejects an end timestamp before the start timestamp', () => {
  assert.throws(
    () => createSession({
      ticketId: 'PROJ-123',
      startAt: '2026-05-04T09:00:00.000Z',
      endAt: '2026-05-04T08:59:59.000Z'
    }),
    /endAt must be greater than or equal to startAt/
  );
});