import { Request, Response } from "express";
import { Types, ClientSession } from "mongoose";
import asyncHandler from "../../utils/asyncHandler";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { runInTransaction } from "../../utils/transaction";
import Refund from "../../models/refund";
import Payment from "../../models/payment";
import User from "../../models/user";
import Member from "../../models/member";
import ScheduledClass from "../../models/scheduledClass";
import {
  CreateMemberRefundDto,
  CreateCashOutDto,
  mapRefundResponseDto,
  mapMemberRecentPaymentDto,
  mapMemberSearchResultDto,
} from "../../dtos/refund.dto";
import { sendRefundToRentalSystem, refundPaymentToRentalSystem } from "../../services/egygap-erp-service";
import logger from "../../config/logger";
import { IRefund } from "../../models/refund";
import { IPayment } from "../../models/payment";
import { startOfDateCairo, endOfDateCairo } from "../../utils/timezone";

async function syncRefundToErp(
  refund: IRefund,
  linkedPayment?: IPayment | null
): Promise<void> {
  try {
    if (linkedPayment) {
      await refundPaymentToRentalSystem(linkedPayment, refund.amount);
      return;
    }
    await sendRefundToRentalSystem(refund);
  } catch (error) {
    logger.error(`Failed to send ${refund.type} ${refund._id} to ERP`, error);
  }
}

function sendCreatedResponse(res: Response, message: string, data: unknown): void {
  res.status(201).json({
    statusCode: 201,
    message,
    data,
  });
}

export const createMemberRefund = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const { reason, amount, memberName, memberId, paymentId } =
      req.body as CreateMemberRefundDto;

    if (!reason || !reason.trim()) {
      throw new BadRequestError("MISSING_FIELDS", "Reason is required");
    }
    if (!memberName || !memberName.trim()) {
      throw new BadRequestError("MISSING_FIELDS", "Member name is required");
    }
    if (amount == null || amount <= 0) {
      throw new BadRequestError("INVALID_AMOUNT", "Amount must be greater than 0");
    }

    let linkedPayment: IPayment | null = null;

    const refund = await runInTransaction(async (session: ClientSession) => {
      const [created] = await Refund.create(
        [
          {
            type: "REFUND",
            reason: reason.trim(),
            amount,
            memberName: memberName.trim(),
            memberId: memberId ? new Types.ObjectId(memberId) : null,
            paymentId: paymentId ? new Types.ObjectId(paymentId) : null,
            recordedBy: authReq.user._id,
            createdAt: new Date(),
          },
        ],
        { session }
      );

      if (paymentId) {
        linkedPayment = await Payment.findByIdAndUpdate(
          paymentId,
          { isRefunded: true, refundReason: reason.trim() },
          { session, new: true }
        );
        if (!linkedPayment) {
          throw new NotFoundError("PAYMENT_NOT_FOUND", "Payment not found");
        }
        if (
          memberId &&
          linkedPayment.uid?.toString() !== memberId
        ) {
          throw new BadRequestError(
            "PAYMENT_MEMBER_MISMATCH",
            "Payment does not belong to this member"
          );
        }

        if (linkedPayment.uid) {
          if (linkedPayment.pkgId) {
            await Member.updateOne(
              {
                uid: linkedPayment.uid,
                packages: {
                  $elemMatch: {
                    pkgId: linkedPayment.pkgId,
                    status: "ACTIVE"
                  }
                }
              },
              {
                $set: { "packages.$[pkg].status": "DELETED" }
              },
              {
                arrayFilters: [
                  {
                    "pkg.pkgId": linkedPayment.pkgId,
                    "pkg.status": "ACTIVE"
                  }
                ],
                session
              }
            );
          } else if (linkedPayment.scid) {
            await Member.updateOne(
              {
                uid: linkedPayment.uid,
                "bookings.scid": { $eq: linkedPayment.scid },
              },
              {
                $pull: { bookings: { scid: linkedPayment.scid } },
              },
              { session }
            );

            await ScheduledClass.removeBookedMember(
              linkedPayment.scid.toString(),
              linkedPayment.uid.toString(),
              session
            );
          }
        }
      }

      return created;
    });

    await refund.populate("recordedBy", "name");
    await syncRefundToErp(refund, linkedPayment);
    sendCreatedResponse(
      res,
      "Member Refund Created!",
      mapRefundResponseDto(refund)
    );
  }
);

export const createCashOut = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const { reason, amount } = req.body as CreateCashOutDto;

    if (!reason || !reason.trim()) {
      throw new BadRequestError("MISSING_FIELDS", "Reason is required");
    }
    if (amount == null || amount <= 0) {
      throw new BadRequestError("INVALID_AMOUNT", "Amount must be greater than 0");
    }

    const refund = await Refund.create({
      type: "CASHOUT",
      reason: reason.trim(),
      amount,
      memberName: null,
      memberId: null,
      paymentId: null,
      recordedBy: authReq.user._id,
      createdAt: new Date(),
    });

    await refund.populate("recordedBy", "name");
    await syncRefundToErp(refund);
    sendCreatedResponse(res, "Cash Out Created!", mapRefundResponseDto(refund));
  }
);

export const listRefunds = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { date } = req.query;

    const filter: Record<string, unknown> = { type: "REFUND" };

    if (date) {
      const parsed = new Date(date as string);
      if (!isNaN(parsed.getTime())) {
        filter.createdAt = {
          $gte: startOfDateCairo(parsed),
          $lte: endOfDateCairo(parsed),
        };
      }
    }

    const refunds = await Refund.find(filter)
      .sort({ createdAt: -1 })
      .populate("recordedBy", "name")
      .populate({
        path: "paymentId",
        select: "purpose amount paymentTime pkgId scid",
        populate: [
          { path: "pkgId", select: "name" },
          { path: "scid", populate: { path: "cid", select: "title" } },
        ],
      });

    res.status(200).json({
      statusCode: 200,
      message: "Refunds Fetched!",
      data: refunds.map((refund) => {
        let paymentLabel: string | null = null;
        const linkedPayment = refund.paymentId as unknown as IPayment | null;
        if (linkedPayment && typeof linkedPayment === "object" && "_id" in linkedPayment) {
          paymentLabel = mapMemberRecentPaymentDto(linkedPayment).label;
        }
        return mapRefundResponseDto(refund, paymentLabel);
      }),
    });
  }
);

export const listCashOuts = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { date } = req.query;

    const filter: Record<string, unknown> = { type: "CASHOUT" };

    if (date) {
      const parsed = new Date(date as string);
      if (!isNaN(parsed.getTime())) {
        filter.createdAt = {
          $gte: startOfDateCairo(parsed),
          $lte: endOfDateCairo(parsed),
        };
      }
    }

    const cashouts = await Refund.find(filter)
      .sort({ createdAt: -1 })
      .populate("recordedBy", "name")
      .populate({
        path: "paymentId",
        select: "purpose amount paymentTime pkgId scid",
        populate: [
          { path: "pkgId", select: "name" },
          { path: "scid", populate: { path: "cid", select: "title" } },
        ],
      });

    res.status(200).json({
      statusCode: 200,
      message: "Cash Outs Fetched!",
      data: cashouts.map((cashout) => {
        let paymentLabel: string | null = null;
        const linkedPayment = cashout.paymentId as unknown as IPayment | null;
        if (linkedPayment && typeof linkedPayment === "object" && "_id" in linkedPayment) {
          paymentLabel = mapMemberRecentPaymentDto(linkedPayment).label;
        }
        return mapRefundResponseDto(cashout, paymentLabel);
      }),
    });
  }
);

export const getRefundByPaymentId = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { paymentId, type } = req.query;

    if (paymentId) {
      const refund = await Refund.findOne({
        paymentId: new Types.ObjectId(paymentId as string),
      }).populate("recordedBy", "name");

      const data = refund ? mapRefundResponseDto(refund) : null;
      res.status(200).json({
        statusCode: 200,
        message: "Refund Fetched!",
        data,
      });
      return;
    }

    if (type) {
      const refunds = await Refund.find({ type: type as string })
        .sort({ createdAt: -1 })
        .populate("recordedBy", "name");

      res.status(200).json({
        statusCode: 200,
        message: "Refunds Fetched!",
        data: refunds.map((r) => mapRefundResponseDto(r)),
      });
      return;
    }

    throw new BadRequestError(
      "MISSING_QUERY_PARAM",
      "paymentId or type query parameter is required"
    );
  }
);

export const searchMembers = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = (req.query.name as string) ?? "";

    if (query.length < 2) {
      res.status(200).json({
        statusCode: 200,
        message: "Members Found!",
        data: [],
      });
      return;
    }

    const members = await User.find({
      name: { $regex: query, $options: "i" },
      role: "member",
    })
      .select("_id name phoneNumber email")
      .limit(10);

    res.status(200).json({
      statusCode: 200,
      message: "Members Found!",
      data: members.map((m) => mapMemberSearchResultDto(m)),
    });
  }
);

export const getMemberRecentPayments = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { memberId } = req.params;

    if (!memberId || !Types.ObjectId.isValid(memberId)) {
      throw new BadRequestError("INVALID_MEMBER_ID", "A valid member ID is required");
    }

    const member = await User.findOne({ _id: memberId, role: "member" }).select(
      "_id name"
    );
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    }

    const memberDoc = await Member.findOne({ uid: memberId });
    const memberPackages = memberDoc ? memberDoc.packages : [];

    const payments = await Payment.find({
      uid: memberId,
      isRefunded: false,
    })
      .sort({ paymentTime: -1 })
      .limit(15)
      .populate("pkgId", "name")
      .populate({
        path: "scid",
        populate: { path: "cid", select: "title" },
      });

    const getUidString = (uid: any): string => {
      if (!uid) return "";
      if (uid instanceof Types.ObjectId || typeof uid === "string") {
        return uid.toString();
      }
      if (uid._id) {
        return uid._id.toString();
      }
      return uid.toString();
    };

    const filteredPayments = [];
    for (const payment of payments) {
      if (payment.scid) {
        const scheduledClass = payment.scid as any;
        const scans = scheduledClass.scans || [];
        const hasAttended = scans.some(
          (scan: any) =>
            getUidString(scan.uid) === memberId.toString() &&
            scan.status === true
        );
        if (hasAttended) {
          continue;
        }
      }
      if (payment.pkgId) {
        const pkgIdStr = payment.pkgId.toString();
        const matchingPkg = memberPackages
          .filter((pkg: any) => pkg.pkgId.toString() === pkgIdStr)
          .reduce((closest: any, current: any) => {
            if (!closest) return current;
            const closestDiff = Math.abs(new Date(closest.pkgStartDate).getTime() - new Date(payment.paymentTime).getTime());
            const currentDiff = Math.abs(new Date(current.pkgStartDate).getTime() - new Date(payment.paymentTime).getTime());
            return currentDiff < closestDiff ? current : closest;
          }, null);

        if (matchingPkg) {
          const isExpired =
            matchingPkg.status === "EXPIRED" ||
            matchingPkg.status === "COMPLETED" ||
            matchingPkg.status === "DELETED" ||
            new Date(matchingPkg.pkgEndDate) < new Date();
          if (isExpired) {
            continue;
          }
        }
      }
      filteredPayments.push(payment);
    }

    res.status(200).json({
      statusCode: 200,
      message: "Member Payments Found!",
      data: filteredPayments.map(mapMemberRecentPaymentDto),
    });
  }
);
