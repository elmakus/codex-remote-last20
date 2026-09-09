# Codex remote history projection

Loopback reverse proxy for the official app-server remote transport. It projects
history replies for one explicitly selected thread to the newest 49 user/agent
messages. Tool items associated with the retained suffix remain. Stored history,
model inputs and live notifications are unchanged. Already displayed Android
messages are not retracted: reopen the thread to request fresh history.

The original deployment and service retain the legacy `last20` name, but the
current tested limit is 49 conversational messages.

No Codex rebuild is required. Install dependencies with `npm ci`, then run
`control.sh setup THREAD_ID DESKTOP_UNIT.service` to bind the experiment to an
existing persistent desktop unit. Run `control.sh switch` to activate it. This
sets `CODEX_APP_SERVER_CHATGPT_BASE_URL`
to `http://127.0.0.1:18749/backend-api` and restarts the desktop. Use `control.sh
rollback` to remove that override and restart. GNOME can move the main Electron
process outside its service; the restart helper explicitly stops that process.
The proxy always forwards to chatgpt.com using verified
TLS and listens on loopback only. It logs method names and counts, never payloads
or authentication headers.

Experimental acceptance: focused tests, loopback health, remote connection,
then owner checks the actual Android view. No claim of Android compatibility
until the last check. `thread/items/list` is observed but not filtered in this
minimal version; if Android uses that path to reload old content, the experiment
must be rolled back rather than expanded silently.

## Safety boundaries

- The proxy listens only on IPv4 loopback and uses verified TLS to
  `chatgpt.com`.
- It logs method names and item counts, never payloads or authorization headers.
- It changes only matching history responses for one configured thread; it does
  not edit stored history, model inputs, live notifications, or rollouts.
- Runtime state, the selected thread ID, systemd drop-ins, credentials, and
  application data do not belong in this repository.
- Activation restarts the desktop application. Keep a usable persistent desktop
  unit and run the focused tests before switching.

## Development

```sh
npm ci
npm test
bash -n control.sh
python3 -m py_compile restart-desktop.py
```

Tests use synthetic thread data and do not contact ChatGPT.

## License

No license is granted by this repository. Do not copy, modify, or redistribute
these files unless you have independent permission from the applicable rights
holder.
