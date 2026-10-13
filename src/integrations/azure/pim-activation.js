const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ACTIVATION_HOURS = 8;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
// launchd starts the server with a bare PATH, so az, jq and pwsh would not be found.
const TOOL_DIRECTORIES = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')];

function runScript(scriptPath, args) {
  const env = { ...process.env, PATH: [...TOOL_DIRECTORIES, process.env.PATH].join(':') };

  return new Promise((resolve) => {
    execFile(scriptPath, args, { env, timeout: RUN_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}${error && !stdout && !stderr ? error.message : ''}` });
    });
  });
}

function toOutputLines(output) {
  return output
    .replace(ANSI_ESCAPE_PATTERN, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

async function isExecutable(filePath) {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function createPimActivation({
  scriptPath,
  statusFilePath,
  run = runScript,
  now = () => new Date()
}) {
  let savedStatus = null;
  let inFlightActivation = null;

  async function loadSavedStatus() {
    if (savedStatus) {
      return savedStatus;
    }

    try {
      savedStatus = JSON.parse(await fs.readFile(statusFilePath, 'utf8'));
    } catch {
      savedStatus = { activeUntil: null, lastRun: null };
    }

    return savedStatus;
  }

  async function saveStatus(status) {
    savedStatus = status;
    await fs.mkdir(path.dirname(statusFilePath), { recursive: true });
    await fs.writeFile(statusFilePath, `${JSON.stringify(status, null, 2)}\n`);
  }

  async function runActivation(justification) {
    const ranAt = now();
    const { ok, output } = await run(scriptPath, [justification, `PT${ACTIVATION_HOURS}H`]);
    const previous = await loadSavedStatus();
    const activeUntil = ok
      ? new Date(ranAt.getTime() + ACTIVATION_HOURS * 60 * 60 * 1000).toISOString()
      : previous.activeUntil;

    await saveStatus({
      activeUntil,
      lastRun: { ranAt: ranAt.toISOString(), ok, lines: toOutputLines(output) }
    });
  }

  return {
    async getStatus() {
      return {
        available: await isExecutable(scriptPath),
        running: Boolean(inFlightActivation),
        ...(await loadSavedStatus())
      };
    },

    activate(justification) {
      inFlightActivation ??= runActivation(justification).finally(() => {
        inFlightActivation = null;
      });

      return inFlightActivation;
    }
  };
}

module.exports = {
  ACTIVATION_HOURS,
  createPimActivation,
  toOutputLines
};
