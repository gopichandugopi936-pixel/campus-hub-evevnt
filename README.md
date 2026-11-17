# Gather — Campus Event Hub

A full-stack capstone starter for a campus event listing and QR ticket check-in system.

## Features

- Responsive event discovery, category filters, and search
- Student accounts, event registration, and personal QR tickets
- Unique opaque QR ticket tokens; only a token digest is stored in the database
- Organizer dashboard with attendance stats, event creation, and check-in
- Camera QR scanning on browsers that support `BarcodeDetector`; manual code entry is included as a fallback
- SQLite database created automatically with sample campus events

## Run locally

Requires Node.js 18 or newer.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Students can create an account with any valid email address. Registration is email-only for this learning prototype; add proper password authentication or campus SSO before using it beyond a classroom demo.

To make an organizer account, set `ORGANIZER_EMAIL` to the email address before creating that account. On PowerShell:

```powershell
$env:ORGANIZER_EMAIL = "organizer@campus.edu"
$env:SESSION_SECRET = "replace-with-a-long-random-secret"
npm start
```

Create an account with that exact email, then use the Organizer link in the navigation. Camera scanning requires a secure browser context (localhost works; deployed sites need HTTPS) and camera permission. If the browser does not support QR detection, enter the `CEH:...` ticket value manually.

## Project structure

```text
public/       Browser app (HTML, CSS, JavaScript)
server.js     Express API, SQLite schema, sessions, and ticket QR generation
data/         Created on first run; local SQLite database and session store
```

## Notes for a production deployment

Set a strong `SESSION_SECRET`, enable HTTPS, add rate limiting and CSRF protection, and replace email-only sign-in with hashed passwords or a campus identity provider. Add organizer account administration and event editing/deletion as follow-on capstone work. QR check-in validates the opaque token on the server and rejects repeat check-ins.
