const test = require('node:test');
const assert = require('node:assert/strict');

const { createJiraClient } = require('../src/integrations/jira/client');

test('createJiraClient posts worklogs with the correct endpoint, headers, and payload', async () => {
  const calls = [];
  const client = createJiraClient({
    baseUrl: 'https://example.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'secret-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        async text() {
          return '';
        }
      };
    }
  });

  await client.sendWorklog({
    ticketId: 'PROJ-7',
    startAt: '2026-05-04T10:00:00.000Z',
    endAt: '2026-05-04T10:15:00.000Z',
    durationMs: 900000,
    durationSeconds: 900,
    synced: false,
    syncError: null
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.atlassian.net/rest/api/3/issue/PROJ-7/worklog');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(
    calls[0].options.headers.Authorization,
    `Basic ${Buffer.from('dev@example.com:secret-token').toString('base64')}`
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    started: '2026-05-04T10:00:00.000+0000',
    timeSpentSeconds: 900,
    comment: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Logged with local time-tracker CLI.'
            }
          ]
        }
      ]
    }
  });
});

test('createJiraClient fetches issue summaries', async () => {
  const calls = [];
  const client = createJiraClient({
    baseUrl: 'https://example.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'secret-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            fields: {
              summary: 'Show ticket summaries in the dashboard'
            }
          });
        }
      };
    }
  });

  const summary = await client.getIssueSummary('PROJ-7');

  assert.equal(summary, 'Show ticket summaries in the dashboard');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.atlassian.net/rest/api/3/issue/PROJ-7?fields=summary');
  assert.equal(calls[0].options.method, 'GET');
});

test('createJiraClient surfaces Jira API failures', async () => {
  const client = createJiraClient({
    baseUrl: 'https://example.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'secret-token',
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({
          errorMessages: ['Issue does not exist']
        });
      }
    })
  });

  await assert.rejects(
    () => client.sendWorklog({
      ticketId: 'PROJ-404',
      startAt: '2026-05-04T10:00:00.000Z',
      endAt: '2026-05-04T10:15:00.000Z',
      durationMs: 900000,
      durationSeconds: 900,
      synced: false,
      syncError: null
    }),
    /Issue does not exist/
  );
});

test('createJiraClient surfaces the reason an issue summary could not be fetched', async () => {
  const client = createJiraClient({
    baseUrl: 'https://example.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'secret-token',
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({
          errorMessages: ['Issue does not exist']
        });
      }
    })
  });

  await assert.rejects(
    () => client.getIssueSummary('PROJ-404'),
    /Issue does not exist/
  );
});

test('createJiraClient refuses to fetch issue summaries when not configured', async () => {
  const client = createJiraClient({
    baseUrl: '',
    email: '',
    apiToken: '',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });

  await assert.rejects(
    () => client.getIssueSummary('PROJ-7'),
    /Jira sync is not configured/
  );
});