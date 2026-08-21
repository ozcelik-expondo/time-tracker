const { getDurationInSeconds } = require('../../domain/session');

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function toJiraTimestamp(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error('timestamp must be a valid ISO-8601 string');
  }

  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}+0000`
  ].join('');
}

function createComment(kind) {
  const text = kind === 'review'
    ? 'Code review logged with local time-tracker CLI.'
    : 'Logged with local time-tracker CLI.';

  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text
          }
        ]
      }
    ]
  };
}

function toJiraWorklog(session) {
  return {
    issueKey: session.ticketId,
    payload: {
      started: toJiraTimestamp(session.startAt),
      timeSpentSeconds: Number.isFinite(session.durationSeconds)
        ? session.durationSeconds
        : getDurationInSeconds(session.startAt, session.endAt),
      comment: createComment(session.kind)
    }
  };
}

module.exports = {
  toJiraTimestamp,
  toJiraWorklog
};