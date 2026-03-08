# Luminary Cloud Setup

## Firebase

1. Create a Firebase project.
2. Enable `Authentication` with the `Email/Password` provider.
3. Create a Firestore database in production or test mode.
4. Copy your web app config into [luminary.config.js](/d:/Luminary%20Memory%20Canvas/luminary.config.js).

## Cloudflare R2

1. Create an R2 bucket.
2. Copy [wrangler.toml.example](/d:/Luminary%20Memory%20Canvas/wrangler.toml.example) to `wrangler.toml`.
3. Set the bucket name and your media hostname.
4. Deploy [cloudflare-worker.js](/d:/Luminary%20Memory%20Canvas/cloudflare-worker.js) with Wrangler.
5. Fill `workerBaseUrl` in [luminary.config.js](/d:/Luminary%20Memory%20Canvas/luminary.config.js).
6. If you do not have a custom domain, leave `publicBaseUrl` and `R2_PUBLIC_HOST` empty. The Worker will serve media from its own `workers.dev` URL.

## Current State

- Firebase Auth and Firestore sync are wired into the app when `luminary.config.js` is filled.
- IndexedDB remains as local cache and fallback.
- The R2 worker now supports `POST /upload-url`, `PUT /upload/:key`, and `GET /media/:key` without a custom domain.
- The app still uses current local media handling until the browser upload path is switched over to the Worker.
