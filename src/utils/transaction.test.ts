import mongoose from "mongoose";
import {
  clearTransactionsSupportedCache,
  isTransientTransactionError,
  runInTransaction,
} from "./transaction";

describe("isTransientTransactionError", () => {
  it("detects TransientTransactionError label", () => {
    expect(
      isTransientTransactionError({
        errorLabels: ["TransientTransactionError"],
      }),
    ).toBe(true);
  });

  it("detects WriteConflict code 112", () => {
    expect(isTransientTransactionError({ code: 112 })).toBe(true);
  });

  it("detects write conflict message", () => {
    expect(
      isTransientTransactionError({
        message:
          "Caused by :: Write conflict during plan execution and yielding is disabled.",
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isTransientTransactionError(new Error("validation failed"))).toBe(
      false,
    );
  });
});

describe("runInTransaction retry", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    clearTransactionsSupportedCache();
    jest.useFakeTimers();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    clearTransactionsSupportedCache();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mockSessions() {
    jest.spyOn(mongoose, "startSession").mockImplementation(async () => {
      return {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(async () => undefined),
        abortTransaction: jest.fn(async () => undefined),
        endSession: jest.fn(),
      } as any;
    });
  }

  it("retries TransientTransactionError and succeeds", async () => {
    mockSessions();

    let attempts = 0;
    const promise = runInTransaction(async () => {
      attempts += 1;
      if (attempts === 1) {
        const err: any = new Error("Write conflict during plan execution");
        err.code = 112;
        err.errorLabels = ["TransientTransactionError"];
        throw err;
      }
      return "ok";
    });

    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry non-transient errors", async () => {
    mockSessions();

    await expect(
      runInTransaction(async () => {
        throw new Error("validation failed");
      }),
    ).rejects.toThrow("validation failed");
  });
});
