require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { createJiraClient } = require('../integrations/jira/client');

const filePath = path.resolve(__dirname, '../../data/tracker-state.json');
const data = require(filePath);

const jiraClient = createJiraClient({
  baseUrl: process.env.JIRA_BASE_URL,
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN
});

function maskToken(value) {
  if (!value) return '(not set)';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
}

function describeJiraConfig() {
  const vars = [
    { name: 'JIRA_BASE_URL', value: process.env.JIRA_BASE_URL, display: process.env.JIRA_BASE_URL || '(not set)' },
    { name: 'JIRA_EMAIL', value: process.env.JIRA_EMAIL, display: process.env.JIRA_EMAIL || '(not set)' },
    { name: 'JIRA_API_TOKEN', value: process.env.JIRA_API_TOKEN, display: maskToken(process.env.JIRA_API_TOKEN) }
  ];

  const lines = vars.map(({ name, value, display }) => `    ${name}: ${display}${value ? '' : '  <-- missing'}`);

  return lines.join('\n');
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function groupDurations(entries) {
  const result = {};

  for (const entry of entries) {
    if (entry.synced !== false) continue;

    const date = entry.startAt.slice(0, 10);
    const ticket = entry.ticketId;

    if (!result[date]) result[date] = {};
    if (!result[date][ticket]) result[date][ticket] = 0;

    result[date][ticket] += entry.durationSeconds;

    // ✅ mark as synced AFTER using it
    entry.synced = true;
    delete entry.syncError;
  }

  return result;
}

async function fetchTicketNames(grouped) {
  const ticketIds = new Set();

  for (const tickets of Object.values(grouped)) {
    for (const ticket of Object.keys(tickets)) {
      ticketIds.add(ticket);
    }
  }

  const names = new Map();

  if (!jiraClient.isConfigured) {
    console.warn(`⚠️  Ticket names unavailable: Jira sync is not configured.\n${describeJiraConfig()}`);
    return names;
  }

  await Promise.all(
    [...ticketIds].map(async (ticketId) => {
      try {
        const summary = await jiraClient.getIssueSummary(ticketId);
        if (summary) {
          names.set(ticketId, summary);
        } else {
          console.warn(`⚠️  ${ticketId}: Jira returned no summary for this issue.`);
        }
      } catch (error) {
        console.warn(`⚠️  ${ticketId}: could not fetch ticket name (${error.message})`);
      }
    })
  );

  return names;
}

function printSummary(grouped, ticketNames) {
  for (const [date, tickets] of Object.entries(grouped)) {
    console.log(`\n${date}`);
    for (const [ticket, totalSeconds] of Object.entries(tickets)) {
      const name = ticketNames.get(ticket);
      const label = name ? `${ticket} (${name})` : ticket;
      console.log(`  ${label}: ${formatDuration(totalSeconds)}`);
    }
  }
}

async function main() {
  const grouped = groupDurations(data?.sessions || []);
  const ticketNames = await fetchTicketNames(grouped);
  printSummary(grouped, ticketNames);

  // ✅ persist changes back to file
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

main();
