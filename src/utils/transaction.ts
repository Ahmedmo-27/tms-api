import mongoose from "mongoose";

const MAX_TRANSACTION_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 50;

let transactionsSupported: boolean | null = null;

/** Test-only: reset cached replica-set capability check. */
export function clearTransactionsSupportedCache(): void {
  transactionsSupported = null;
}

async function checkTransactionsSupported(): Promise<boolean> {
  if (transactionsSupported !== null) return transactionsSupported;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await session.commitTransaction();
    transactionsSupported = true;
  } catch {
    transactionsSupported = false;
  } finally {
    session.endSession();
  }

  return transactionsSupported;
}

export function isTransientTransactionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    errorLabels?: string[];
    code?: number;
    codeName?: string;
    message?: string;
  };
  if (e.errorLabels?.includes("TransientTransactionError")) return true;
  if (e.errorLabels?.includes("UnknownTransactionCommitResult")) return true;
  if (e.code === 112) return true;
  if (e.codeName === "WriteConflict") return true;
  if (
    typeof e.message === "string" &&
    e.message.toLowerCase().includes("write conflict")
  ) {
    return true;
  }
  return false;
}

function retryDelayMs(attempt: number): number {
  return BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
}

export async function runInTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  const canTransact =
    process.env.NODE_ENV !== "testing" && (await checkTransactionsSupported());

  if (!canTransact) {
    return fn(undefined as unknown as mongoose.ClientSession);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (err) {
      try {
        await session.abortTransaction();
      } catch {
        // ignore abort failures
      }
      lastError = err;
      const shouldRetry =
        isTransientTransactionError(err) &&
        attempt < MAX_TRANSACTION_RETRIES - 1;
      if (!shouldRetry) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs(attempt))
      );
    } finally {
      session.endSession();
    }
  }

  throw lastError;
}
