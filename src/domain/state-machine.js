const { createSession } = require('./session');

function createInitialState() {
  return {
    status: 'idle',
    activeEntry: null,
    sessions: []
  };
}

function beginWork(state, ticketId, at, kind = 'work') {
  return {
    ...state,
    status: 'working',
    activeEntry: {
      ticketId,
      startAt: at,
      kind
    }
  };
}

function endActiveWork(state, at) {
  if (!state.activeEntry) {
    return state;
  }

  const completedSession = createSession({
    ticketId: state.activeEntry.ticketId,
    startAt: state.activeEntry.startAt,
    endAt: at,
    kind: state.activeEntry.kind
  });

  return {
    status: 'idle',
    activeEntry: null,
    sessions: [...state.sessions, completedSession]
  };
}

function applyCommand(state, command) {
  switch (command.type) {
    case 'start':
    case 'switch': {
      const stoppedState = endActiveWork(state, command.at);
      return beginWork(stoppedState, command.ticketId, command.at, command.kind);
    }
    case 'pause':
    case 'punchOut':
      return endActiveWork(state, command.at);
    default:
      throw new Error(`Unsupported command type: ${command.type}`);
  }
}

module.exports = {
  createInitialState,
  applyCommand
};