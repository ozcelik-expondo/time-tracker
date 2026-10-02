const uiState = {
  trackerState: null,
  connectionError: null,
  toastTimeoutId: null
};

const dom = {
  statusNote: document.querySelector('#status-note'),
  statusBadge: document.querySelector('#status-badge'),
  headerTimer: document.querySelector('#header-timer'),
  ticketInput: document.querySelector('#ticket-input'),
  startSwitchButton: document.querySelector('#start-switch-button'),
  reviewButton: document.querySelector('#review-button'),
  pauseButton: document.querySelector('#pause-button'),
  currentSessionBadge: document.querySelector('#current-session-badge'),
  currentSession: document.querySelector('#current-session'),
  sessionLog: document.querySelector('#session-log'),
  lastWorkedSummary: document.querySelector('#last-working-day-summary'),
  lastWorkedLog: document.querySelector('#last-working-day-log'),
  toast: document.querySelector('#toast')
};

function formatClockDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function formatHumanDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (parts.length === 0 || (hours === 0 && minutes < 1)) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function formatDayLabel(date) {
  return new Intl.DateTimeFormat([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function normalizeTicketId(value) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  const browseMatch = trimmedValue.match(/(?:^https?:\/\/[^/]+)?\/?browse\/([^/?#]+)/i);
  const normalizedValue = browseMatch ? browseMatch[1] : trimmedValue;

  return normalizedValue.trim().replace(/\/+$/g, '').toUpperCase();
}

function getEntryKind(entry) {
  return entry?.kind === 'review' ? 'review' : 'work';
}

function getLocalDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isSameLocalDay(timestamp, referenceDate) {
  return getLocalDayKey(new Date(timestamp)) === getLocalDayKey(referenceDate);
}

function getActiveEntrySnapshot(state, referenceDate) {
  if (!state?.activeEntry) {
    return null;
  }

  return {
    ticketId: state.activeEntry.ticketId,
    startAt: state.activeEntry.startAt,
    endAt: referenceDate.toISOString(),
    durationMs: referenceDate.getTime() - Date.parse(state.activeEntry.startAt),
    kind: getEntryKind(state.activeEntry),
    isActive: true
  };
}

function getEntriesForDay(state, referenceDate = new Date(), { includeActive = false } = {}) {
  if (!state) {
    return [];
  }

  const entries = state.sessions
    .filter((session) => isSameLocalDay(session.startAt, referenceDate) || isSameLocalDay(session.endAt, referenceDate))
    .map((session) => ({
      ...session,
      kind: getEntryKind(session),
      isActive: false
    }));
  const activeEntry = includeActive ? getActiveEntrySnapshot(state, referenceDate) : null;

  if (activeEntry) {
    entries.push(activeEntry);
  }

  return entries.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
}

function getTodayEntries(state, referenceDate = new Date()) {
  return getEntriesForDay(state, referenceDate, { includeActive: true });
}

function getLastWorkedDay(state, referenceDate = new Date(), { maxLookbackDays = 60 } = {}) {
  const candidate = new Date(referenceDate);

  for (let i = 0; i < maxLookbackDays; i++) {
    candidate.setDate(candidate.getDate() - 1);
    const entries = getEntriesForDay(state, candidate);

    if (entries.length > 0) {
      return { date: new Date(candidate), entries };
    }
  }

  return { date: candidate, entries: [] };
}

function getDashboardStatus(state, todayEntries) {
  if (state?.activeEntry) {
    const isReview = getEntryKind(state.activeEntry) === 'review';

    return {
      label: isReview ? 'Reviewing' : 'Working',
      tone: isReview ? 'reviewing' : 'working',
      note: isReview ? 'A code review is running right now.' : 'An active ticket is running right now.'
    };
  }

  if (todayEntries.length > 0) {
    return {
      label: 'Paused',
      tone: 'paused',
      note: 'No active ticket. Enter one to resume instantly.'
    };
  }

  return {
    label: 'Not started',
    tone: 'idle',
    note: 'No ticket started today yet.'
  };
}

function getCurrentSessionViewModel(state, todayEntries) {
  if (state?.activeEntry) {
    const activeEntry = todayEntries.find((entry) => entry.isActive);
    const isReview = getEntryKind(activeEntry) === 'review';

    return {
      ticketId: activeEntry.ticketId,
      startAt: activeEntry.startAt,
      durationMs: activeEntry.durationMs,
      kind: activeEntry.kind,
      statusLabel: isReview ? 'Reviewing' : 'Working',
      tone: isReview ? 'reviewing' : 'working'
    };
  }

  const latestCompletedEntry = [...todayEntries].reverse().find((entry) => !entry.isActive);

  if (latestCompletedEntry) {
    return {
      ticketId: latestCompletedEntry.ticketId,
      startAt: latestCompletedEntry.startAt,
      durationMs: latestCompletedEntry.durationMs,
      kind: latestCompletedEntry.kind,
      statusLabel: 'Paused',
      tone: 'paused'
    };
  }

  return null;
}

function getTotalDuration(entries) {
  return entries.reduce((sum, entry) => sum + entry.durationMs, 0);
}

function groupEntriesByTicketAndKind(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const kind = getEntryKind(entry);
    const key = `${entry.ticketId}::${kind}`;

    if (!groups.has(key)) {
      groups.set(key, { ticketId: entry.ticketId, kind, entries: [] });
    }

    groups.get(key).entries.push(entry);
  }

  return Array.from(groups.values());
}

function getTicketSummary(ticketId) {
  const summary = uiState.trackerState?.ticketDetails?.[ticketId]?.summary;

  if (typeof summary !== 'string') {
    return null;
  }

  const trimmedSummary = summary.trim();

  return trimmedSummary.length > 0 ? trimmedSummary : null;
}

function createTicketLabel(ticketId, variant = 'inline', kind = 'work') {
  const label = document.createElement('span');
  label.className = `ticket-label ${variant}`;

  const key = document.createElement('span');
  key.className = 'ticket-key';
  key.textContent = ticketId;
  label.append(key);

  if (kind === 'review') {
    const reviewTag = document.createElement('span');
    reviewTag.className = 'review-tag';
    reviewTag.textContent = 'Code review';
    label.append(reviewTag);
  }

  const summary = getTicketSummary(ticketId);

  if (summary) {
    const summaryText = document.createElement('span');
    summaryText.className = 'ticket-summary';
    summaryText.textContent = summary;
    label.append(summaryText);
  }

  return label;
}

function renderRecapSummary(entries, date) {
  dom.lastWorkedSummary.textContent = '';

  if (entries.length === 0) {
    dom.lastWorkedSummary.className = 'recap-summary empty-state';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'No tracked time recorded yet.';
    dom.lastWorkedSummary.append(paragraph);
    return;
  }

  dom.lastWorkedSummary.className = 'recap-summary';
  const totalDurationMs = getTotalDuration(entries);

  const hero = document.createElement('div');
  hero.className = 'recap-total';

  const heroLabel = document.createElement('span');
  heroLabel.className = 'summary-label';
  heroLabel.textContent = `${formatDayLabel(date)} total`;

  const heroValue = document.createElement('strong');
  heroValue.textContent = formatHumanDuration(totalDurationMs);

  hero.append(heroLabel, heroValue);

  dom.lastWorkedSummary.append(hero);
}

function showToast(message) {
  clearTimeout(uiState.toastTimeoutId);
  dom.toast.textContent = message;
  dom.toast.classList.add('visible');
  uiState.toastTimeoutId = window.setTimeout(() => {
    dom.toast.classList.remove('visible');
  }, 2800);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Request failed.');
  }

  return payload;
}

async function refreshState() {
  try {
    uiState.trackerState = await requestJson('/state');
    uiState.connectionError = null;
    render();
  } catch (error) {
    uiState.connectionError = error.message;
    render();
    showToast(error.message);
  }
}

async function submitAction(path, payload, successMessage) {
  try {
    uiState.trackerState = await requestJson(path, {
      method: 'POST',
      body: payload ? JSON.stringify(payload) : '{}'
    });
    uiState.connectionError = null;
    render();
    if (successMessage) {
      showToast(successMessage);
    }
  } catch (error) {
    uiState.connectionError = error.message;
    render();
    showToast(error.message);
  }
}

function buildTicketActionPath(ticketId, kind) {
  const activeEntry = uiState.trackerState?.activeEntry;

  if (activeEntry?.ticketId === ticketId && getEntryKind(activeEntry) === kind) {
    return null;
  }

  return activeEntry ? '/switch' : '/start';
}

async function startEntry(kind) {
  const inputTicket = normalizeTicketId(dom.ticketInput.value);
  let ticketId = inputTicket;

  const todayEntries = getTodayEntries(uiState.trackerState);
  const entryNoun = kind === 'review' ? 'review' : 'ticket';

  if (!ticketId) {
    const latestCompletedEntry = [...todayEntries].reverse().find((entry) => !entry.isActive && entry.kind === kind);

    if (latestCompletedEntry) {
      ticketId = latestCompletedEntry.ticketId;
      showToast(`Resuming ${ticketId}.`);
    } else {
      showToast(`Enter a ticket to ${kind === 'review' ? 'review' : 'start'} first.`);
      dom.ticketInput.focus();
      return;
    }
  }

  const path = buildTicketActionPath(ticketId, kind);

  if (!path) {
    showToast(`Already tracking ${ticketId}.`);
    return;
  }

  const startedMessage = kind === 'review' ? `Started reviewing ${ticketId}.` : `Started ${ticketId}.`;
  await submitAction(path, { ticketId, kind }, path === '/switch' ? `Switched to ${entryNoun} ${ticketId}.` : startedMessage);
  dom.ticketInput.value = '';
  dom.ticketInput.focus();
}

function setStatusBadge(element, label, tone) {
  element.className = `status-badge ${tone}`;
  element.textContent = label;
}

function renderCurrentSession(viewModel) {
  dom.currentSession.textContent = '';

  if (!viewModel) {
    dom.currentSession.className = 'current-session-card empty-state';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'No active ticket.';
    dom.currentSession.append(paragraph);
    return;
  }

  dom.currentSession.className = 'current-session-card';

  const ticketDisplay = document.createElement('div');
  ticketDisplay.className = 'ticket-display';
  ticketDisplay.append(createTicketLabel(viewModel.ticketId, 'stacked', viewModel.kind));

  const metadata = document.createElement('div');
  metadata.className = 'session-metadata';

  const startedItem = document.createElement('div');
  startedItem.className = 'meta-item';
  startedItem.innerHTML = `<span class="meta-label">Started</span><span class="meta-value">${formatTime(viewModel.startAt)}</span>`;

  const durationItem = document.createElement('div');
  durationItem.className = 'meta-item';
  durationItem.innerHTML = `<span class="meta-label">Duration</span><span class="meta-value">${formatClockDuration(viewModel.durationMs)}</span>`;

  const statusItem = document.createElement('div');
  statusItem.className = 'meta-item';
  statusItem.innerHTML = `<span class="meta-label">Status</span><span class="meta-value">${viewModel.statusLabel}</span>`;

  metadata.append(startedItem, durationItem, statusItem);
  dom.currentSession.append(ticketDisplay, metadata);
}

function renderSessionLog(entries) {
  dom.sessionLog.textContent = '';

  if (entries.length === 0) {
    dom.sessionLog.className = 'session-log empty-state';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'No sessions yet today.';
    dom.sessionLog.append(paragraph);
    return;
  }

  dom.sessionLog.className = 'session-log';

  for (const { ticketId, kind, entries: ticketEntries } of groupEntriesByTicketAndKind(entries)) {
    const group = document.createElement('section');
    group.className = 'ticket-group';

    const title = document.createElement('h3');
    title.className = 'ticket-group-title';
    title.append(createTicketLabel(ticketId, 'stacked', kind));
    group.append(title);

    for (const entry of ticketEntries) {
      const row = document.createElement('div');
      row.className = 'session-row';

      const left = document.createElement('div');
      const range = document.createElement('div');
      range.className = 'session-range';
      range.textContent = `${formatTime(entry.startAt)} → ${entry.isActive ? 'Now' : formatTime(entry.endAt)}`;
      left.append(range);

      const subtext = document.createElement('div');
      subtext.className = 'session-subtext';
      subtext.textContent = entry.isActive ? (kind === 'review' ? 'Reviewing' : 'Working') : 'Completed';
      left.append(subtext);

      const right = document.createElement('strong');
      right.textContent = formatHumanDuration(entry.durationMs);

      row.append(left, right);
      group.append(row);
    }

    dom.sessionLog.append(group);
  }
}

function renderLastWorkedDayLog(entries) {
  dom.lastWorkedLog.textContent = '';

  if (entries.length === 0) {
    dom.lastWorkedLog.className = 'session-log empty-state';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'No sessions logged yet.';
    dom.lastWorkedLog.append(paragraph);
    return;
  }

  dom.lastWorkedLog.className = 'session-log';

  for (const { ticketId, kind, entries: ticketEntries } of groupEntriesByTicketAndKind(entries)) {
    const group = document.createElement('section');
    group.className = 'ticket-group';

    const title = document.createElement('h3');
    title.className = 'ticket-group-title';
    title.append(createTicketLabel(ticketId, 'stacked', kind));
    group.append(title);

    for (const entry of ticketEntries) {
      const row = document.createElement('div');
      row.className = 'session-row';

      const left = document.createElement('div');
      const range = document.createElement('div');
      range.className = 'session-range';
      range.textContent = `${formatTime(entry.startAt)} → ${formatTime(entry.endAt)}`;
      left.append(range);

      const subtext = document.createElement('div');
      subtext.className = 'session-subtext';
      subtext.textContent = 'Completed';
      left.append(subtext);

      const right = document.createElement('strong');
      right.textContent = formatHumanDuration(entry.durationMs);

      row.append(left, right);
      group.append(row);
    }

    dom.lastWorkedLog.append(group);
  }
}

function render() {
  const now = new Date();
  const todayEntries = getTodayEntries(uiState.trackerState, now);
  const { date: lastWorkedDate, entries: lastWorkedEntries } = getLastWorkedDay(uiState.trackerState, now);
  const dashboardStatus = getDashboardStatus(uiState.trackerState, todayEntries);
  const currentView = getCurrentSessionViewModel(uiState.trackerState, todayEntries);
  const todayTotalDurationMs = getTotalDuration(todayEntries);

  setStatusBadge(dom.statusBadge, dashboardStatus.label, dashboardStatus.tone);
  setStatusBadge(dom.currentSessionBadge, currentView?.statusLabel ?? dashboardStatus.label, currentView?.tone ?? dashboardStatus.tone);
  dom.statusNote.textContent = uiState.connectionError ?? dashboardStatus.note;
  dom.headerTimer.textContent = formatClockDuration(todayTotalDurationMs);
  dom.pauseButton.disabled = !uiState.trackerState?.activeEntry;

  renderCurrentSession(currentView);
  renderSessionLog(todayEntries);
  renderRecapSummary(lastWorkedEntries, lastWorkedDate);
  renderLastWorkedDayLog(lastWorkedEntries);
}

dom.startSwitchButton.addEventListener('click', () => {
  startEntry('work');
});

dom.reviewButton.addEventListener('click', () => {
  startEntry('review');
});

dom.pauseButton.addEventListener('click', () => {
  submitAction('/pause', null, 'Stopped current session.');
});

dom.ticketInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    startEntry('work');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== dom.ticketInput) {
    event.preventDefault();
    dom.ticketInput.focus();
  }
});

window.setInterval(() => {
  render();
}, 1000);

window.setInterval(() => {
  refreshState();
}, 30000);

refreshState();