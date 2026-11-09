# Beekeeper Studio web app (PWA)

The browser UI connects to a local headless server running the same database handlers as desktop. Database files, SSH keys, imports, exports and backups refer to the **server's filesystem**, not the browser's. The server shares the desktop user-data directory and saved connections. Avoid running desktop and web sessions against the same connection simultaneously.

## Build and run

Use the repository's supported Node version and Yarn. From the repository root:

```sh
yarn install --frozen-lockfile
yarn bks:web:build
yarn bks:web:serve
```

`bks:web:build` builds the UI kit, browser UI and server. The studio workspace also has `yarn build:web` (requires the built UI kit), `yarn web:serve`, and `yarn dev:web`. The root `web:serve` alias still runs sqltools, not Studio. For development, start the server first, authenticate at `http://localhost:3004/api/platform-info?token=YOUR_TOKEN`, then open `http://localhost:3004/index-web.html`; Vite proxies `/api` and `/ws`. Service-worker registration is disabled in development; use the production build for offline testing.

Native drivers must match the installed **Electron** ABI, not the system Node ABI. `web:serve` uses Electron in Node mode. Use prebuilt binaries for that Electron version where available; for example run `prebuild-install --runtime=electron --target=<electron-version>` inside the installed better-sqlite3 package.

The server prints a URL such as `http://127.0.0.1:7457/?token=...`. The token URL is only needed once per browser profile. It sets a persistent, 400-day HttpOnly, SameSite=Strict authentication cookie and redirects to remove the token. The cookie survives browser restarts; later visits and installed launches use `/`. If the cookie is cleared or expires, or the server token is rotated, reopen the tokenized URL. HTTPS connections set a Secure cookie; HTTPS reverse proxies must connect from loopback and set `X-Forwarded-Proto: https`. Forwarded protocol headers from non-loopback clients are not trusted. The token is stored in `web-server-token` in the desktop user-data directory, or supplied using `BKS_WEB_TOKEN`.

Default bind is `127.0.0.1:7457`; configure `BKS_WEB_HOST` and `BKS_WEB_PORT` if needed. Keep the server running while using the app. Offline caching only loads the UI shell; database access requires the server. A dropped WebSocket reconnects automatically and signals the existing utility-restart dialog; reconnect to the database to resume work. In-flight queries fail rather than being replayed.

## Install

- **Windows:** Open the authenticated URL in Edge or Chrome, then click the install-app icon in the address bar (or Apps / Install Beekeeper Studio in the browser menu).
- **Ubuntu:** In Chromium/Chrome, open the authenticated URL and choose Install Beekeeper Studio from the address bar or menu.
- **Omarchy:** Use Chromium's install action, or Omarchy's web app installer with `http://127.0.0.1:7457/`. Authenticate in the resulting browser profile using the tokenized URL if prompted. Do not store the token in launcher arguments.

Installation and clipboard access require a secure context. HTTP on localhost/127.0.0.1 works. **LAN HTTP does not.** For remote use, put the server behind an HTTPS reverse proxy (Caddy/nginx), forwarding HTTP and WebSocket upgrades and preserving the public `Host` and `Origin`. For a private tailnet, `tailscale serve --bg http://127.0.0.1:7457` supplies HTTPS; verify its proxy preserves matching Host/Origin headers or configure a reverse proxy to do so. Open the HTTPS URL with the token query once. Never enable a public tunnel or disable Origin validation.

## Autostart

Linux: create `~/.config/systemd/user/beekeeper-web.service`, adjusting absolute paths:

```ini
[Unit]
Description=Beekeeper Studio web server
After=network.target

[Service]
WorkingDirectory=/home/USER/beekeeper-studio/apps/studio
Environment=ELECTRON_RUN_AS_NODE=1
ExecStart=/home/USER/beekeeper-studio/node_modules/electron/dist/electron /home/USER/beekeeper-studio/apps/studio/dist/webServer.js
Restart=on-failure

[Install]
WantedBy=default.target
```

Run `systemctl --user daemon-reload && systemctl --user enable --now beekeeper-web`. Use `journalctl --user -u beekeeper-web` for logs (the token URL is sensitive). A user service starts at login unless lingering is explicitly enabled.

Windows: in Task Scheduler create a task triggered **At log on**, running as the normal user, not Administrator. Program: `C:\Windows\System32\cmd.exe`; arguments: `/c "set ELECTRON_RUN_AS_NODE=1&& C:\path\beekeeper-studio\node_modules\electron\dist\electron.exe C:\path\beekeeper-studio\apps\studio\dist\webServer.js"`; Start in: `C:\path\beekeeper-studio\apps\studio`. Quote executable/script paths separately if they contain spaces. Alternatively put a shortcut to a batch file with those commands in `shell:startup`. Native binaries and built files must remain at those paths.

## Security and v1 limitations

- The token grants powerful database and filesystem access, including saving files to arbitrary server paths. Treat it like a password. Do not share URLs, logs or screenshots containing it. Restrict user-data/token file permissions and run the server as an unprivileged user. Rotate by stopping the server and deleting `web-server-token` (or changing `BKS_WEB_TOKEN`).
- Bind loopback by default. Exposing a LAN bind requires HTTPS, firewall restrictions, and trusted users. Tokens are not a multi-user authorization system. Serve this app on a dedicated origin; do not host untrusted scripts alongside it.
- File pickers ask for server-side paths. SQLite creation, imports, exports, SQL file open/save and backup paths work with files accessible to the server. Multi-file selection uses one path per line. There is no browser-local upload/download picker, native folder reveal, executable discovery UI or OS file association integration. Overwrite confirmation remains the user's responsibility when entering a save path.
- Async clipboard consumers use the browser clipboard API and require permission. Legacy synchronous table/Vim paste uses a manual-paste prompt. Image copy depends on browser ClipboardItem support.
- Native window controls, native plugin menu items, desktop menu IPC actions, updater, fullscreen/window management and Snap SSH plug detection are unavailable/no-ops. Use in-app controls where available. Desktop-only titlebar window buttons are hidden.
- Azure interactive authentication that requests `process.parentPort` external navigation is not supported in web mode. Use another authentication method. OS credential/keychain dialogs and other desktop-only integrations may also be unavailable.
- Plugins requiring Electron APIs may not work. Browser popup blockers can prevent external links; only HTTP, HTTPS and mailto links are allowed.
- Cached shell/assets do not cache API replies, tokens, database results or WebSocket traffic. Offline database operation is not supported.
