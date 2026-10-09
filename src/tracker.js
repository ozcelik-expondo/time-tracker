const { applyCommand } = require('./domain/state-machine');
const { buildSessionId, getDurationInSeconds } = require('./domain/session');
const { normalizeTicketId } = require('./domain/ticket-id');

// Jira rejects worklogs under a minute ("Worklog must not be null."), so retrying them is pointless.
const MIN_WORKLOG_SECONDS = 60;

function createNoopWorklogSync() {
  return {
    isConfigured: false,
    async sendSession() {
      throw new Error('Jira sync is not configured.');
    }
  };
}

function createStoredSessionRecord(session) {
  return {
    ...session,
    id: buildSessionId(session),
    durationSeconds: getDurationInSeconds(session.startAt, session.endAt),
    synced: false,
    syncError: null
  };
}

function withStoredSessionRecords(state, startIndex) {
  if (state.sessions.length <= startIndex) {
    return state;
  }

  return {
    ...state,
    sessions: [
      ...state.sessions.slice(0, startIndex),
      ...state.sessions.slice(startIndex).map(createStoredSessionRecord)
    ]
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createTracker({
  store,
  now = () => new Date().toISOString(),
  worklogSync = createNoopWorklogSync()
}) {
  // Sessions currently being sent, so overlapping syncs (a pause and the retry timer) don't
  // post the same worklog twice.
  const inFlightSessionIds = new Set();

  async function syncSessionIds(sessionIds) {
    if (sessionIds.length === 0 || !worklogSync.isConfigured) {
      return store.load();
    }

    const loadedState = await store.load();
    const sessionsToSync = sessionIds
      .map((sessionId) => loadedState.sessions.find((session) => session.id === sessionId))
      .filter((session) => session && !session.synced && !session.syncSkipped && !inFlightSessionIds.has(session.id));

    if (sessionsToSync.length === 0) {
      return loadedState;
    }

    const updatesById = new Map();

    for (const session of sessionsToSync) {
      if (session.durationSeconds < MIN_WORKLOG_SECONDS) {
        updatesById.set(session.id, {
          synced: false,
          syncSkipped: true,
          syncError: `Shorter than ${MIN_WORKLOG_SECONDS} seconds; Jira does not accept it.`
        });
        continue;
      }

      inFlightSessionIds.add(session.id);

      try {
        await worklogSync.sendSession(session);
        updatesById.set(session.id, { synced: true, syncError: null });
      } catch (error) {
        updatesById.set(session.id, { synced: false, syncError: getErrorMessage(error) });
      } finally {
        inFlightSessionIds.delete(session.id);
      }
    }

    // Reload so commands saved while Jira requests were pending are not overwritten.
    const currentState = await store.load();
    const nextState = {
      ...currentState,
      sessions: currentState.sessions.map((session) => (
        updatesById.has(session.id) ? { ...session, ...updatesById.get(session.id) } : session
      ))
    };

    await store.save(nextState);

    return nextState;
  }

  async function runCommand(command) {
    const currentState = await store.load();
    const normalizedCommand = command.ticketId
      ? {
          ...command,
          ticketId: normalizeTicketId(command.ticketId)
        }
      : command;

    if (
      normalizedCommand.ticketId &&
      currentState.activeEntry?.ticketId === normalizedCommand.ticketId &&
      (currentState.activeEntry?.kind ?? 'work') === (normalizedCommand.kind ?? 'work')
    ) {
      return currentState;
    }

    const { autoPause, ...stateCommand } = normalizedCommand;
    // The auto-pause notice lasts only until the next command.
    const { autoPause: previousAutoPause, ...appliedState } = applyCommand(currentState, {
      ...stateCommand,
      at: stateCommand.at ?? now()
    });
    const nextState = autoPause ? { ...appliedState, autoPause } : appliedState;
    const completedSessionStartIndex = currentState.sessions.length;
    const persistedState = withStoredSessionRecords(nextState, completedSessionStartIndex);

    await store.save(persistedState);

    const completedSessionIds = persistedState.sessions
      .slice(completedSessionStartIndex)
      .map((session) => session.id);

    if (completedSessionIds.length === 0) {
      return persistedState;
    }

    return syncSessionIds(completedSessionIds);
  }

  return {
    async getState() {
      return store.load();
    },

    async start(ticketId, kind = 'work') {
      return runCommand({ type: 'start', ticketId, kind });
    },

    async switch(ticketId, kind = 'work') {
      return runCommand({ type: 'switch', ticketId, kind });
    },

    async pause() {
      return runCommand({ type: 'pause' });
    },

    async autoPause(at) {
      const state = await store.load();
      const { activeEntry } = state;

      if (!activeEntry) {
        return state;
      }

      return runCommand({
        type: 'pause',
        at,
        autoPause: { ticketId: activeEntry.ticketId, kind: activeEntry.kind, at }
      });
    },


    async syncUnsyncedSessions() {
      const state = await store.load();
      const unsyncedSessionIds = state.sessions
        .filter((session) => !session.synced && !session.syncSkipped)
        .map((session) => session.id);

      return syncSessionIds(unsyncedSessionIds);
    }
  };
}

module.exports = {
  createTracker
};