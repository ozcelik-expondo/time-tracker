function toEpochMilliseconds(timestamp) {
  const value = Date.parse(timestamp);

  if (Number.isNaN(value)) {
    throw new Error('timestamp must be a valid ISO-8601 string');
  }

  return value;
}

function getDurationInMilliseconds(startAt, endAt) {
  const startMs = toEpochMilliseconds(startAt);
  const endMs = toEpochMilliseconds(endAt);

  if (endMs < startMs) {
    throw new Error('endAt must be greater than or equal to startAt');
  }

  return endMs - startMs;
}

function getDurationInSeconds(startAt, endAt) {
  return Math.floor(getDurationInMilliseconds(startAt, endAt) / 1000);
}

function buildSessionId(session) {
  return `${session.ticketId}:${session.startAt}:${session.endAt}`;
}

function createSession({ ticketId, startAt, endAt, kind = 'work' }) {
  return {
    ticketId,
    startAt,
    endAt,
    durationMs: getDurationInMilliseconds(startAt, endAt),
    kind
  };
}

module.exports = {
  buildSessionId,
  createSession,
  getDurationInMilliseconds,
  getDurationInSeconds
};