#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
DESKTOP_UNIT="$(cat "$HERE/desktop-unit.txt" 2>/dev/null || echo chatgpt-community.service)"
DROPIN="$UNIT_DIR/$DESKTOP_UNIT.d/90-remote-last20.conf"
restart_desktop() { python3 "$HERE/restart-desktop.py" "$DESKTOP_UNIT"; }
case "${1:-}" in
  setup)
    test -n "${2:-}"
    [[ "$2" =~ ^[a-zA-Z0-9_-]+$ ]]
    [[ "$HERE" =~ ^/[a-zA-Z0-9._/-]+$ ]]
    DESKTOP_UNIT="${3:-$DESKTOP_UNIT}"
    [[ "$DESKTOP_UNIT" =~ ^[a-zA-Z0-9_-]+\.service$ ]]
    python3 "$HERE/restart-desktop.py" "$DESKTOP_UNIT" --check
    printf '%s\n' "$DESKTOP_UNIT" > "$HERE/desktop-unit.txt"
    DROPIN="$UNIT_DIR/$DESKTOP_UNIT.d/90-remote-last20.conf"
    test ! -e "$DROPIN"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/codex-remote-last20.service" <<EOF
[Unit]
Description=Experimental recent-history projection for one Android remote thread
[Service]
Type=simple
WorkingDirectory=$HERE
Environment=LAST20_THREAD=$2
ExecStart=/usr/bin/node $HERE/proxy.mjs
Restart=on-failure
RestartSec=2
EOF
    systemctl --user daemon-reload
    systemctl --user start codex-remote-last20.service
    ;;
  switch)
    test ! -e "$DROPIN"
    python3 "$HERE/restart-desktop.py" "$DESKTOP_UNIT" --check
    trap 'trap - ERR; "$HERE/control.sh" rollback' ERR
    mkdir -p "$(dirname "$DROPIN")"
    cat > "$DROPIN" <<'EOF'
[Unit]
Wants=codex-remote-last20.service
After=codex-remote-last20.service
[Service]
Environment=CODEX_APP_SERVER_CHATGPT_BASE_URL=http://127.0.0.1:18749/backend-api
EOF
    systemctl --user daemon-reload
    date -u +%FT%TZ > "$HERE/switch-status.txt"
    restart_desktop
    for attempt in {1..20}; do
      if journalctl --user -u codex-remote-last20.service --since "$(head -n 1 "$HERE/switch-status.txt")" --no-pager -o cat | grep -q '"event":"remote-connected"'; then
        echo 'connected; Android display verification pending' >> "$HERE/switch-status.txt"
        exit 0
      fi
      sleep 3
    done
    echo 'no remote connection; rolling back' >> "$HERE/switch-status.txt"
    "$HERE/control.sh" rollback
    ;;
  rollback)
    if test -f "$DROPIN"; then
      rm -- "$DROPIN"
      systemctl --user daemon-reload
      restart_desktop
    fi
    systemctl --user stop codex-remote-last20.service
    echo 'rolled back' >> "$HERE/switch-status.txt"
    ;;
  *) echo 'Usage: control.sh setup THREAD_ID [DESKTOP_UNIT.service] | switch | rollback' >&2; exit 2 ;;
esac
