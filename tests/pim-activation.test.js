const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createPimActivation, toOutputLines } = require('../src/integrations/azure/pim-activation');

const RAN_AT = new Date('2026-10-13T07:30:00.000Z');

async function createActivation({ run, scriptPath } = {}) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'time-tracker-pim-'));
  const executablePath = path.join(tempDirectory, 'pim-activate');

  await fs.writeFile(executablePath, '#!/bin/sh\n', { mode: 0o755 });

  return createPimActivation({
    scriptPath: scriptPath ?? executablePath,
    statusFilePath: path.join(tempDirectory, 'azure-access.json'),
    run: run ?? (async () => ({ ok: true, output: '' })),
    now: () => RAN_AT
  });
}

test('toOutputLines strips colour codes and blank lines', () => {
  assert.deepEqual(toOutputLines('\u001b[31;1mfailed\u001b[0m\n\n  ✅ role\n'), ['failed', '  ✅ role']);
});

test('when the script is missing, status should report activation as unavailable', async () => {
  const activation = await createActivation({ scriptPath: '/nonexistent/pim-activate' });

  assert.equal((await activation.getStatus()).available, false);
});

test('when activating, should pass the justification and an 8 hour duration to the script', async () => {
  const calls = [];
  const activation = await createActivation({
    run: async (scriptPath, args) => {
      calls.push(args);
      return { ok: true, output: '' };
    }
  });

  await activation.activate('Working on COM-1284');

  assert.deepEqual(calls, [['Working on COM-1284', 'PT8H']]);
});

test('when the script succeeds, should mark access active for 8 hours from the run', async () => {
  const activation = await createActivation({
    run: async () => ({ ok: true, output: '  ✅ Key Vault Secrets User @ vault\n' })
  });

  await activation.activate('Daily development work');
  const status = await activation.getStatus();

  assert.equal(status.activeUntil, '2026-10-13T15:30:00.000Z');
  assert.deepEqual(status.lastRun, {
    ranAt: RAN_AT.toISOString(),
    ok: true,
    lines: ['  ✅ Key Vault Secrets User @ vault']
  });
});

test('given an earlier successful run, when the script fails, should keep the earlier active-until time', async () => {
  const results = [{ ok: true, output: '' }, { ok: false, output: '  ❌ vault: MFA required\n' }];
  const activation = await createActivation({ run: async () => results.shift() });

  await activation.activate('Daily development work');
  await activation.activate('Daily development work');
  const status = await activation.getStatus();

  assert.equal(status.activeUntil, '2026-10-13T15:30:00.000Z');
  assert.equal(status.lastRun.ok, false);
  assert.deepEqual(status.lastRun.lines, ['  ❌ vault: MFA required']);
});

test('when activation is requested again while running, should run the script only once', async () => {
  let runCount = 0;
  let finishRun;
  const activation = await createActivation({
    run: () => {
      runCount += 1;
      return new Promise((resolve) => {
        finishRun = () => resolve({ ok: true, output: '' });
      });
    }
  });

  const first = activation.activate('Daily development work');
  const second = activation.activate('Daily development work');

  assert.equal((await activation.getStatus()).running, true);
  finishRun();
  await Promise.all([first, second]);

  assert.equal(runCount, 1);
  assert.equal((await activation.getStatus()).running, false);
});
