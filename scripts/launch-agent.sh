#!/bin/sh
# Installs or removes a launchd agent that runs the web server at login and keeps it running.
set -eu

LABEL="com.time-tracker.web"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/time-tracker"
# macOS lists background items by the launched executable, so launch a wrapper named after
# the app instead of node itself (which would show up as "Node.js Foundation").
LAUNCHER_DIR="$HOME/Library/Application Support/Time Tracker"
LAUNCHER="$LAUNCHER_DIR/Time Tracker"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE_BIN="$(command -v node)"
    mkdir -p "$LOG_DIR" "$LAUNCHER_DIR" "$(dirname "$PLIST")"
    cat > "$LAUNCHER" <<LAUNCHER
#!/bin/sh
exec "$NODE_BIN" "$REPO_DIR/src/web/server.js"
LAUNCHER
    chmod +x "$LAUNCHER"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$LAUNCHER</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/web.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/web.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed $LABEL (node: $NODE_BIN). Logs: $LOG_DIR/web.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    rm -rf "$LAUNCHER_DIR"
    echo "Removed $LABEL"
    ;;
  *)
    echo "Usage: $0 install|uninstall" >&2
    exit 1
    ;;
esac
