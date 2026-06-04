import admin from "../config/firebase";
import logger from "../config/logger";

/**
 * Firebase constraints
 */
const FCM_MAX_TOKENS = 500;

/**
 * Optional: replace this with your actual token repository
 */
async function removeInvalidToken(token: string) {
  // Example:
  // await DeviceTokenModel.deleteOne({ token });
}

export class NotificationsService {
  /**
   * Notify users on the waiting list about a newly available slot
   */
  static async notifyWaitingList(
    users: string[],
    title: string,
    dayIndex: number
  ) {

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ]; 
    const day = dayNames[dayIndex]

    const message = `A new slot is available for ${title} on ${day}`;

    return this.sendNotification(
      users,
      "A SLOT AVAILABLE",
      message,
      {
        type: "WAITLIST_SLOT_AVAILABLE",
        title,
        day,
      }
    );
  }

  /**
   * Send push notifications to multiple users
   */
  static async sendNotification(
    users: string[],
    title: string,
    body: string,
    data?: Record<string, string>
  ) {
    if (!users || users.length === 0) return;

    // Ensure FCM data payload is string-only
    const safeData: Record<string, string> = Object.fromEntries(
      Object.entries(data ?? {}).map(([k, v]) => [k, String(v)])
    );

    const chunks = this.chunkTokens(users, FCM_MAX_TOKENS);

    for (const tokens of chunks) {
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title,
          body,
        },
        data: safeData,
        android: {
          priority: "high" as const,
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
            },
          },
        },
      };

      try {
        const response = await admin
          .messaging()
          .sendEachForMulticast(message);

        if (response.failureCount > 0) {
          await this.handleFailures(response.responses, tokens);
        }
      } catch (error) {
        logger.error("FCM multicast send failed", error);
        throw error;
      }
    }
  }

  /**
   * Handle failed FCM responses
   */
  private static async handleFailures(
    responses: admin.messaging.SendResponse[],
    tokens: string[]
  ) {
    const invalidTokens: string[] = [];

    responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;

        if (
          errorCode === "messaging/registration-token-not-registered" ||
          errorCode === "messaging/invalid-registration-token"
        ) {
          invalidTokens.push(tokens[idx]);
        }

        logger.warn("FCM send failure", {
          token: tokens[idx],
          error: resp.error?.message,
          code: errorCode,
        });
      }
    });

    // Clean up invalid tokens
    for (const token of invalidTokens) {
      try {
        await removeInvalidToken(token);
      } catch (err) {
        logger.error("Failed to remove invalid FCM token", {
          token,
          error: err,
        });
      }
    }
  }

  /**
   * Split tokens into Firebase-safe chunks
   */
  private static chunkTokens(tokens: string[], size: number): string[][] {
    const chunks: string[][] = [];

    for (let i = 0; i < tokens.length; i += size) {
      chunks.push(tokens.slice(i, i + size));
    }

    return chunks;
  }
}