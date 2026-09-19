# TMS API

REST API backend for **The Mind Space** gym management platform. Node.js / Express / TypeScript with MongoDB (Mongoose), JWT auth, Socket.io, Firebase (FCM), and Swagger docs. See `docs/API_DOCUMENTATION.md` for full architecture and route reference.

## Cursor Cloud specific instructions

Single service (the API). Standard commands live in `package.json` scripts and `docs/API_DOCUMENTATION.md` — use those. The notes below cover only non-obvious environment caveats.

### Required runtime environment variables (not in `dev.env`)

`dev.env` is loaded via dotenv but intentionally omits secrets. The server and DB scripts need these; `dotenv` does not override already-exported vars, so export them before running:

- `MONGO_URI` — e.g. `mongodb://127.0.0.1:27017/tms_dev`. Without it, `connectDB` logs `MONGOOSE_URL is not defined` and calls `process.exit(1)`.
- `JWT_SECRET` — any non-empty string in dev; required for register/login/auth middleware.

Firebase, email (Resend/IMAP), and ERP integrations are optional: they self-disable with a warning when their env vars are absent, so the server still boots.

### MongoDB

- MongoDB 8.0 (`mongod`) is installed in the VM image but is **not auto-started**. Start it before running the server or DB scripts:
  `mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017` (data dir `/data/db` already exists).
- A standalone `mongod` does not support transactions. This is expected — `src/utils/transaction.ts` detects this and transparently runs without a session, so all write flows work.

### Running the server

- Dev: `MONGO_URI=... JWT_SECRET=... npm run dev` (nodemon + ts-node, watches `src/`, serves on `PORT` / default 5000).
- Health check: `GET /` returns `API running!`. Swagger UI at `/api-docs`.
- All routes are mounted at both root and under `/api` (e.g. `/auth/login` and `/api/auth/login`).

### Tests

- Run the full suite with `npx jest --runInBand`. The `npm test` script uses `--changedSince=master`, so it runs **nothing** on a clean tree — use it only for changed-file runs.
- `jest.config.js` references `src/tests/setup.ts`, which is **gitignored** (the whole `src/tests/` dir is). It starts an in-memory `mongodb-memory-server` and connects Mongoose. This file exists in the VM image; if it is ever missing, recreate it (start `MongoMemoryServer`, `mongoose.connect(uri)`, clear collections `afterEach`, disconnect `afterAll`). Committed tests all mock their dependencies and do not need a real DB, but jest still requires this setup file to exist.
- `mongodb-memory-server` downloads its binary on first run (already cached in the VM image).

### Lint / build

- `npm run build` (tsc) — clean.
- `npx eslint .` runs but reports pre-existing errors in the codebase (mostly `@typescript-eslint/no-explicit-any`); this is the repo's current state, not an environment problem.
