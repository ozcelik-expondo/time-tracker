const fs = require('node:fs/promises');
const path = require('node:path');

const { createInitialState } = require('../domain/state-machine');
const {
  buildSessionId,
  getDurationInMilliseconds,
  getDurationInSeconds
} = require('../domain/session');
const { normalizeTicketId } = require('../domain/ticket-id');

function normalizeKind(kind) {
  return kind === 'review' ? 'review' : 'work';
}

function normalizeActiveEntry(activeEntry) {
  if (!activeEntry) {
    return null;
  }

  return {
    ticketId: normalizeTicketId(activeEntry.ticketId),
    startAt: activeEntry.startAt,
    kind: normalizeKind(activeEntry.kind)
  };
}

function normalizeSession(session) {
  const normalizedTicketId = normalizeTicketId(session.ticketId);
  const normalizedSession = {
    ...session,
    ticketId: normalizedTicketId
  };
  const durationMs = Number.isFinite(session?.durationMs)
    ? session.durationMs
    : getDurationInMilliseconds(normalizedSession.startAt, normalizedSession.endAt);

  return {
    id: typeof session?.id === 'string' ? buildSessionId(normalizedSession) : buildSessionId(normalizedSession),
    ticketId: normalizedSession.ticketId,
    startAt: normalizedSession.startAt,
    endAt: normalizedSession.endAt,
    durationMs,
    durationSeconds: Number.isFinite(session?.durationSeconds)
      ? session.durationSeconds
      : getDurationInSeconds(normalizedSession.startAt, normalizedSession.endAt),
    kind: normalizeKind(session?.kind),
    synced: session?.synced === true,
    syncError: typeof session?.syncError === 'string' ? session.syncError : null
  };
}

async function ensureStateFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    await fs.writeFile(filePath, `${JSON.stringify(createInitialState(), null, 2)}\n`);
  }
}

function normalizeState(value) {
  return {
    status: value?.status === 'working' ? 'working' : 'idle',
    activeEntry: normalizeActiveEntry(value?.activeEntry ?? null),
    sessions: Array.isArray(value?.sessions) ? value.sessions.map(normalizeSession) : []
  };
}

function createFileStateStore({ filePath }) {
  return {
    async load() {
      await ensureStateFile(filePath);
      const contents = await fs.readFile(filePath, 'utf8');
      return normalizeState(JSON.parse(contents));
    },

    async save(state) {
      await ensureStateFile(filePath);
      await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
    }
  };
}

module.exports = {
  createFileStateStore
};