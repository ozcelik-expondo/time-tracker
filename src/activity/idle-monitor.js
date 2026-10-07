const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DISPLAY_ASSERTION_PATTERN = /\b(NoDisplaySleepAssertion|PreventUserIdleDisplaySleep)\b/;
const IGNORED_ASSERTION_OWNERS = new Set(['powerd', 'WindowServer']);

function parseHidIdleMilliseconds(ioregOutput) {
  const match = /"HIDIdleTime" = (\d+)/.exec(ioregOutput);

  if (!match) {
    throw new Error('HIDIdleTime not found in ioreg output.');
  }

  return Math.floor(Number(match[1]) / 1e6);
}

// Video calls keep the display awake and hold the microphone, even when no keys are pressed.
function hasMeetingSignal(pmsetOutput) {
  return pmsetOutput.split('\n').some((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('Resources:') && /\baudio-in\b/.test(trimmed)) {
      return true;
    }

    const owner = /^pid \d+\(([^)]+)\):/.exec(trimmed)?.[1];

    return Boolean(owner) && !IGNORED_ASSERTION_OWNERS.has(owner) && DISPLAY_ASSERTION_PATTERN.test(trimmed);
  });
}

async function readMacActivity() {
  const [{ stdout: ioregOutput }, { stdout: pmsetOutput }] = await Promise.all([
    execFileAsync('/usr/sbin/ioreg', ['-r', '-c', 'IOHIDSystem', '-k', 'HIDIdleTime', '-d', '1']),
    execFileAsync('/usr/bin/pmset', ['-g', 'assertions'])
  ]);

  return {
    idleMs: parseHidIdleMilliseconds(ioregOutput),
    inMeeting: hasMeetingSignal(pmsetOutput)
  };
}

function createIdleMonitor({
  tracker,
  readActivity = readMacActivity,
  now = () => Date.now(),
  idleThresholdMs,
  intervalMs = 60 * 1000,
  logger = console
}) {
  let lastActiveAtMs = now();
  let lastCheckAtMs = lastActiveAtMs;
  let intervalId = null;

  async function check() {
    const nowMs = now();
    // A gap longer than the threshold means the process was frozen (Mac asleep), so the
    // current reading says nothing about the gap and must not move lastActiveAt past it.
    const wasSuspended = nowMs - lastCheckAtMs > idleThresholdMs;
    lastCheckAtMs = nowMs;

    let activity;

    try {
      activity = await readActivity();
    } catch (error) {
      logger.error(`Idle check failed: ${error instanceof Error ? error.message : error}`);
      return;
    }

    const observedActiveAtMs = activity.inMeeting ? nowMs : nowMs - activity.idleMs;

    if (!wasSuspended) {
      lastActiveAtMs = Math.max(lastActiveAtMs, observedActiveAtMs);
    }

    if (nowMs - lastActiveAtMs >= idleThresholdMs) {
      const { activeEntry } = await tracker.getState();

      if (activeEntry) {
        const endAtMs = Math.max(lastActiveAtMs, Date.parse(activeEntry.startAt));
        const endAt = new Date(endAtMs).toISOString();

        await tracker.autoPause(endAt);
        logger.log(`Auto-paused ${activeEntry.ticketId} at ${endAt} after inactivity.`);
      }
    }

    lastActiveAtMs = Math.max(lastActiveAtMs, observedActiveAtMs);
  }

  return {
    check,

    start() {
      intervalId = setInterval(() => {
        check().catch((error) => logger.error(error));
      }, intervalMs);
    },

    stop() {
      clearInterval(intervalId);
    }
  };
}

module.exports = {
  createIdleMonitor,
  hasMeetingSignal,
  parseHidIdleMilliseconds
};
