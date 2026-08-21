const test = require('node:test');
const assert = require('node:assert/strict');

const { toJiraWorklog } = require('../src/integrations/jira/worklog-adapter');

test('toJiraWorklog maps a completed session to Jira worklog payload', () => {
  const result = toJiraWorklog({
    ticketId: 'PROJ-123',
    startAt: '2026-05-04T09:00:00.000Z',
    endAt: '2026-05-04T09:42:30.000Z',
    durationMs: 2550000,
    durationSeconds: 2550,
    kind: 'work',
    synced: false,
    syncError: null
  });

  assert.deepEqual(result, {
    issueKey: 'PROJ-123',
    payload: {
      started: '2026-05-04T09:00:00.000+0000',
      timeSpentSeconds: 2550,
      comment: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Logged with local time-tracker CLI.'
              }
            ]
          }
        ]
      }
    }
  });
});

test('toJiraWorklog marks review sessions distinctly from regular work', () => {
  const result = toJiraWorklog({
    ticketId: 'PROJ-123',
    startAt: '2026-05-04T09:00:00.000Z',
    endAt: '2026-05-04T09:42:30.000Z',
    durationMs: 2550000,
    durationSeconds: 2550,
    kind: 'review',
    synced: false,
    syncError: null
  });

  assert.equal(
    result.payload.comment.content[0].content[0].text,
    'Code review logged with local time-tracker CLI.'
  );
});