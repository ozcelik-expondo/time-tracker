const { applyCommand } = require('./domain/state-machine');
const { buildSessionId, getDurationInSeconds } = require('./domain/session');
const { normalizeTicketId } = require('./domain/ticket-id');

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
  async function syncSessionIds(sessionIds) {
    if (sessionIds.length === 0 || !worklogSync.isConfigured) {
      return store.load();
    }

    const currentState = await store.load();
    const updatedSessions = [...currentState.sessions];
    let didChange = false;

    for (const sessionId of sessionIds) {
      const sessionIndex = updatedSessions.findIndex((session) => session.id === sessionId);

      if (sessionIndex === -1 || updatedSessions[sessionIndex].synced) {
        continue;
      }

      try {
        await worklogSync.sendSession(updatedSessions[sessionIndex]);
        updatedSessions[sessionIndex] = {
          ...updatedSessions[sessionIndex],
          synced: true,
          syncError: null
        };
      } catch (error) {
        updatedSessions[sessionIndex] = {
          ...updatedSessions[sessionIndex],
          synced: false,
          syncError: getErrorMessage(error)
        };
      }

      didChange = true;
    }

    if (!didChange) {
      return currentState;
    }

    const nextState = {
      ...currentState,
      sessions: updatedSessions
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
        .filter((session) => !session.synced)
        .map((session) => session.id);

      return syncSessionIds(unsyncedSessionIds);
    }
  };
}

module.exports = {
  createTracker
};