/**
 * Global Jest setup — loaded via `setupFilesAfterEnv` in jest.config.js.
 *
 * Keeps the unit suite hermetic:
 *  - deterministic env so modules that read process.env at import time behave
 *    the same on every machine and in CI,
 *  - winston silenced so test output stays readable,
 *  - no accidental network or real database access.
 */

// ── Deterministic environment ──────────────────────────────────────────────
// Only defaults: a test that needs a different value still overrides it.
const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: "test",
  ENVIRONMENT: "testing",
  JWT_SECRET: "jest-unit-suite-secret",
  MONGO_URI: "mongodb://127.0.0.1:27017/tms-jest-should-not-connect",
  TZ: "UTC",

  // Branch / location wiring used by location-scope + matcha helpers.
  MAIN_LOCATION_ID: "6a3e9509c72a8d349f150900",
  CAIRO_LOCATION_ID: "6a3e9509c72a8d349f150901",
  MATCHA_LOCATION_ID: "6a3e9509c72a8d349f150910",
  MATCHA_BRANCH_NAME: "Matcha",
  MAIN_BRANCH_NAME: "The Mind Space",
  LEGACY_OPEN_GYM_DEFAULT_LOCATION_ID: "6a3e9509c72a8d349f150900",

  // NOTE: deliberately absent — LATEST_APP_VERSION, MIN_REQUIRED_APP_VERSION
  // and BLOCK_MISSING_APP_VERSION. appVersion.middleware.ts owns the canonical
  // defaults (DEFAULT_LATEST_APP_VERSION / DEFAULT_MIN_REQUIRED_APP_VERSION)
  // and its tests assert them, so setting them here would shadow the code
  // under test.

  // Third parties: unroutable placeholders. Any real call fails loudly and fast
  // instead of reaching a live service from a test run.
  GEIDEA_URL: "http://127.0.0.1:9",
  GEIDEA_API_PASSWORD: "test-geidea-password",
  GEIDEA_MERCHANT_KEY: "test-geidea-key",
  EGYGAP_ERP_BASE_URL: "http://127.0.0.1:9",
  EGYGAP_ERP_LOGIN_URL: "http://127.0.0.1:9/login",
  EGYGAP_ERP_SALES_URL: "http://127.0.0.1:9/sales",
  RESEND_API_KEY: "re_test_key_not_real",
  EXPOSED_PAYMENTS_API_KEY: "test-exposed-api-key",
  MAIL_USER: "jest@example.test",
  MAIL_APP_PASSWORD: "jest-mail-password",
  MAIL_FROM_ADDRESS: "jest@example.test",
  MAIL_FROM_NAME: "Jest Runner",
  MAIL_DOMAIN: "example.test",
  TICKET_SENDER_EMAIL: "tickets@example.test",
  TICKET_SENDER_NAME: "Jest Tickets",
  RENTAL_STORE_ID: "jest-store",
  RENTAL_USER: "jest-rental-user",
  RENTAL_PASS: "jest-rental-pass",
  ENABLE_MISSED_SESSION_NOTIFICATIONS: "false",
  FORCE_SECURE_COOKIES: "false",
};

for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
}

// ── Silence winston ────────────────────────────────────────────────────────
// Required before any module that imports the logger, hence setupFilesAfterEnv.
// `jest --silent` hides console.* but not winston's own transports.
jest.mock("../config/logger", () => {
  const noop = () => undefined;
  return {
    __esModule: true,
    default: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      verbose: noop,
      silly: noop,
      log: noop,
      child: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
    },
  };
});

// ── Guard rails ───────────────────────────────────────────────────────────
// Unit tests must not reach the network. A test that genuinely needs HTTP
// mocks fetch itself, which replaces this guard for that test's scope.
const realFetch = globalThis.fetch;
beforeEach(() => {
  if (globalThis.fetch === realFetch) {
    globalThis.fetch = (async (input: unknown) => {
      throw new Error(
        `Unmocked network call in a unit test: ${String(input)}. ` +
          `Mock it, or move the test to the integration suite.`,
      );
    }) as typeof fetch;
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// Mongoose connections are never opened by the unit suite; if a stray `connect`
// leaves a handle open Jest would hang, so fail loudly with --detectOpenHandles.
jest.setTimeout(30_000);

export {};
