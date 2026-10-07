const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createIdleMonitor,
  hasMeetingSignal,
  parseHidIdleMilliseconds
} = require('../src/activity/idle-monitor');
const { createFileStateStore } = require('../src/storage/file-state-store');
const { createTracker } = require('../src/tracker');

const MINUTE = 60 * 1000;
const START_MS = Date.parse('2026-10-06T08:00:00.000Z');

async function createTrackerAt(clock) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'time-tracker-idle-'));
  const store = createFileStateStore({ filePath: path.join(tempDirectory, 'state.json') });

  return createTracker({ store, now: () => new Date(clock.ms).toISOString() });
}

function createMonitor(tracker, clock, activity) {
  return createIdleMonitor({
    tracker,
    now: () => clock.ms,
    readActivity: async () => activity.current,
    idleThresholdMs: 30 * MINUTE,
    logger: { log() {}, error() {} }
  });
}

test('parseHidIdleMilliseconds converts ioreg nanoseconds', () => {
  assert.equal(parseHidIdleMilliseconds('    "HIDIdleTime" = 57890492916\n'), 57890);
  assert.throws(() => parseHidIdleMilliseconds('nothing here'));
});

test('hasMeetingSignal detects call apps and microphone use, ignores system assertions', () => {
  const idleOutput = [
    'Assertion status system-wide:',
    '   PreventUserIdleDisplaySleep    1',
    'Listed by owning process:',
    '   pid 344(powerd): [0x1] 02:03:09 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"',
    '   pid 404(WindowServer): [0x2] 00:00:22 UserIsActive named: "tickle"'
  ].join('\n');
  const teamsOutput = `${idleOutput}\n   pid 693(MSTeams): [0x3] 00:52:14 NoDisplaySleepAssertion named: "Microsoft Teams Call in progress"`;
  const micOutput = `${idleOutput}\n   pid 428(coreaudiod): [0x4] 00:52:19 PreventUserIdleSystemSleep named: "mic"\n\tResources: audio-in BuiltInMicrophoneDevice`;

  assert.equal(hasMeetingSignal(idleOutput), false);
  assert.equal(hasMeetingSignal(teamsOutput), true);
  assert.equal(hasMeetingSignal(micOutput), true);
});

test('idle monitor auto-pauses at the last active moment once the threshold is reached', async () => {
  const clock = { ms: START_MS };
  const activity = { current: { idleMs: 0, inMeeting: false } };
  const tracker = await createTrackerAt(clock);
  const monitor = createMonitor(tracker, clock, activity);

  await tracker.start('COM-1');

  // Last input at minute 40, then checks every minute.
  for (let minute = 1; minute <= 69; minute += 1) {
    clock.ms = START_MS + minute * MINUTE;
    activity.current = { idleMs: Math.max(0, minute - 40) * MINUTE, inMeeting: false };
    await monitor.check();
  }
  assert.equal((await tracker.getState()).status, 'working');

  clock.ms = START_MS + 70 * MINUTE;
  activity.current = { idleMs: 30 * MINUTE, inMeeting: false };
  await monitor.check();

  const state = await tracker.getState();
  const lastActiveAt = new Date(START_MS + 40 * MINUTE).toISOString();

  assert.equal(state.activeEntry, null);
  assert.equal(state.sessions.at(-1).endAt, lastActiveAt);
  assert.deepEqual(state.autoPause, { ticketId: 'COM-1', kind: 'work', at: lastActiveAt });

  await tracker.start('COM-2');
  assert.equal((await tracker.getState()).autoPause, undefined);
});

test('idle monitor treats an active meeting as activity', async () => {
  const clock = { ms: START_MS };
  const activity = { current: { idleMs: 0, inMeeting: false } };
  const tracker = await createTrackerAt(clock);
  const monitor = createMonitor(tracker, clock, activity);

  await tracker.start('COM-1');

  for (let minute = 1; minute <= 60; minute += 1) {
    clock.ms = START_MS + minute * MINUTE;
    activity.current = { idleMs: minute * MINUTE, inMeeting: true };
    await monitor.check();
  }

  assert.equal((await tracker.getState()).status, 'working');
});

test('idle monitor ends the session before the Mac went to sleep', async () => {
  const clock = { ms: START_MS };
  const activity = { current: { idleMs: 0, inMeeting: false } };
  const tracker = await createTrackerAt(clock);
  const monitor = createMonitor(tracker, clock, activity);

  await tracker.start('COM-1');

  clock.ms = START_MS + 5 * MINUTE;
  activity.current = { idleMs: 1000, inMeeting: false };
  await monitor.check();

  // Lid closed overnight; the first check after waking sees fresh input.
  clock.ms = START_MS + 16 * 60 * MINUTE;
  activity.current = { idleMs: 1000, inMeeting: false };
  await monitor.check();

  const state = await tracker.getState();

  assert.equal(state.activeEntry, null);
  assert.equal(state.sessions.at(-1).endAt, new Date(START_MS + 5 * MINUTE - 1000).toISOString());
});
