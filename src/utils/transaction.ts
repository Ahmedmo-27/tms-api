import mongoose from "mongoose";

let transactionsSupported: boolean | null = null;

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

export async function runInTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  const canTransact =
    process.env.NODE_ENV !== "testing" && (await checkTransactionsSupported());

  if (!canTransact) {
    return fn(undefined as unknown as mongoose.ClientSession);
  }

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
      // ignore
    }
    throw err;
  } finally {
    session.endSession();
  }
}
