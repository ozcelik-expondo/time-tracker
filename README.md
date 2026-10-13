# Time Tracker

Minimal local time tracking for ticket-based work. The project is built in Node.js, stores state in JSON on disk, and includes a small single-page web UI on top of the tracker core.

## What It Does

- Tracks one active ticket at a time.
- Supports `start`, `switch`, and `pause` flows.
- Persists sessions locally in `data/tracker-state.json`.
- Shows human-readable status and reports in the web UI.
- Optionally syncs completed sessions to Jira worklogs.
- Exposes a lightweight web dashboard over the same backend logic.

## Requirements

- Node.js 22+ recommended.
- npm 10+ recommended.

## Install

```bash
npm install
npm test
```

<!-- CLI removed: the project now exposes only the web UI -->

## Web UI

Start the local web server:

```bash
npm run web
```

Default URL:

```text
http://localhost:9999
```

Optional server environment variable:

- `PORT` overrides the default web port.

The web UI is a thin layer over the existing tracker and exposes these backend routes:

- `GET /state`
- `POST /start`
- `POST /switch`
- `POST /pause`


## Idle Auto-Pause (macOS)

While the server runs, it checks keyboard/mouse idle time every minute. After `IDLE_AUTO_PAUSE_MINUTES` (default 30, `0` disables) without input, the running timer is stopped at the moment of your last input, before anything is synced to Jira. Active video calls (display-sleep assertions or microphone in use) count as activity, and time the Mac spent asleep counts as idle.

To keep the server running in the background, install it as a launchd agent (starts at login, restarts on crash, logs to `~/Library/Logs/time-tracker/web.log`):

```bash
npm run agent:install
npm run agent:uninstall
```

## Azure Access (PIM)

The header shows an **Activate Azure access** button when the `pim-activate` script exists (default `~/.local/bin/pim-activate`, override with `PIM_ACTIVATE_SCRIPT`). It runs the script with the current ticket as justification and an 8 hour duration, then shows how long access stays active. The button turns orange once access has expired, as a reminder. If the Azure CLI session has no MFA, the script opens a browser sign-in first. A run takes about a minute. The last result is stored in `data/azure-access.json`; hover the button to see the full output.

## Jira Sync

Jira sync is optional. The tracker always saves locally first, then attempts to sync completed sessions. It supports scoped OAuth tokens.

Environment variables used by the Jira integration:

- `JIRA_BASE_URL`
- `JIRA_API_TOKEN` (requires 'write:issue.time-tracking:jira' scope)

Example `.env` setup:

```text
JIRA_BASE_URL="https://your-domain.atlassian.net"
JIRA_API_TOKEN="your-scoped-token"
```

- Notes:

- Jira sync only runs when those variables are present.
- Failed Jira sends do not lose local sessions.
- Unsynced sessions remain in local state and can be retried from the web UI controls.
- The project includes `.env.example` as a reference, but the app does not load env files automatically.

## Storage

Local state is stored at:

```text
data/tracker-state.json
```

Each completed session stores:

- `ticketId`
- `startAt`
- `endAt`
- `durationMs`
- `durationSeconds`
- `synced`
- `syncError`

## Testing

The project uses Node's built-in test runner.

```bash
npm test
```

The test suite covers:

- Session creation and duration logic
- State transitions
- File persistence
- Tracker orchestration
- (CLI removed; behavior covered via unit tests of the tracker core)
- Jira adapter and client mapping

## Project Layout

```text
.
├── data/
├── src/
│   ├── web/
│   ├── domain/
│   ├── integrations/
│   │   └── jira/
│   ├── storage/
│   ├── web/
│   │   └── public/
│   ├── index.js
│   └── tracker.js
├── tests/
├── .env.example
├── package.json
└── README.md
```

## Design Notes

- Core business logic stays in `src/domain`.
- Persistence stays in `src/storage`.
- CLI and web are thin interfaces over the same tracker.
- Jira integration is isolated in `src/integrations/jira` and is optional.
- Local persistence is the source of truth.