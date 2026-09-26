# Video Hub Desktop

The Desktop build is a Windows Electron wrapper around the Next.js application.

## Build policy

Windows installers are built on a real Windows CI runner. A developer PC should not need to run npm install or compile the application to use a release build.

The packaged app stores its SQLite database under Electron's userData directory and uses a local loopback server. The application uses a single-instance lock and selects a free local port when the default port is occupied.

## CI

Use the `Video Hub Windows Desktop` workflow to build an NSIS installer and a Portable executable. The workflow also runs a packaged-app smoke test through `/api/health` and Prisma database bootstrap before uploading artifacts.
