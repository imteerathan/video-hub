# Video Hub V1.0

Video Hub is a user-authenticated catalog/player for external video Sources. It extracts permitted public media metadata and presents it through the Video Hub UI. It does not bypass DRM, authentication, paywalls, CAPTCHA, or access controls.

## V1.0 Production Hardening

- SSRF protection for Source URLs, redirects, HLS manifests and subtitle URLs.
- Blocks loopback, private, link-local and local/internal hostnames.
- Redirects are validated hop-by-hop and capped at 5 hops.
- Text responses are capped at 8 MB to limit memory abuse.
- 15 second network timeout for scanner/resolution requests.
- Login, registration, scan and media-resolution rate limits.
- Constant-time comparison for the scan cron secret.
- Security response headers including CSP, frame protection, MIME sniffing protection and referrer policy.
- Per-source scan lock prevents duplicate concurrent scans in the same server process.
- Scheduled scanning uses bounded concurrency (`SCAN_MAX_CONCURRENCY`, default 2, max 4).
- Structured scan start/completion/failure logging.
- Source creation validates URLs with DNS/IP checks before persistence.
- Watch history continues to be scoped to the authenticated user.

## Environment

```env
DATABASE_URL="file:./dev.db"
SCAN_CRON_SECRET="replace-with-a-long-random-secret"
SCAN_MAX_CONCURRENCY="2"
```

For a multi-instance deployment, replace the in-memory rate limiter and scan lock with shared infrastructure such as Redis/Upstash before relying on them as a global distributed control.

## Install / run

```bash
npm install
npm run prisma:generate
npm run dev
```

For production:

```bash
npm run build
npm run start
```

## Safe-source boundary

Only scan sources and media that the authenticated user is permitted to access. Video Hub intentionally does not implement DRM bypass, credential harvesting, CAPTCHA bypass, paywall bypass, or access-control circumvention.

## PC Desktop track (V1.1)

Video Hub now has a Windows desktop shell based on Electron. The same Next.js application remains the core UI/API, while Electron provides a native desktop window, secure renderer isolation, and lifecycle management for the local server.

### Desktop development

```bash
npm install
npm run prisma:generate
npm run desktop:dev
```

### Windows packaging

```bash
npm run build
npm run desktop:package
```

The packaging command produces an NSIS installer and a portable Windows build in `release/`.
