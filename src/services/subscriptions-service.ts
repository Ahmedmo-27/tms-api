import Member from "../models/member";
import Package, { getPackageEndDate } from "../models/package";
import PromoCode from "../models/promoCode";
import { Types } from "mongoose";
import { PaymentsService } from "./payments-service";
import { NotFoundError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";
import { ClientSession } from "mongoose";
import logger from "../config/logger";
import NonUserPackage from "../models/nonUserPackage";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";
import { IClassRestrictionRecord } from "../models/member";
import { ChallengeService } from "./challenge-service";
import User from "../models/user";
import { Server as SocketIOServer } from "socket.io";

export class SubscriptionsService {
  static async frontDeskSubscribeToPackage(
    uid: string,
    pkgId: string,
    startDate: string,
    paymentMethod: string,
    paymentDate?: string,
    amount?: number,
    note?: string,
    io?: SocketIOServer,
  ) {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
        pkgId,
      });
    startDate = new Date(startDate).toISOString();
    if (paymentDate) {
      paymentDate = new Date(paymentDate).toISOString();
    }
    const packageId = new Types.ObjectId(pkgId);
    const endDate = getPackageEndDate(startDate, pkg).toISOString();

    let restrictions: IClassRestrictionRecord[];

    if (pkg.classRestrictions) {
      restrictions = [];
      pkg.classRestrictions.forEach((cls) => {
        restrictions.push({
          cid: cls.cid,
          limit: cls.limit,
        });
      });
    }

    await runInTransaction(async (session: ClientSession) => {
      const payment = await PaymentsService.savePayment(
        uid,
        amount || pkg.price,
        paymentMethod,
        "PACKAGE",
        session,
        undefined,
        undefined,
        undefined,
        packageId,
        paymentDate,
        note,
      );
      await Member.addPackage(
        uid,
        pkg._id.toString(),
        pkg.name,
        pkg.numberOfSessions,
        startDate,
        endDate,
        session,
        restrictions,
      );
      if (io && pkg.coachId) {
        const user = await User.findOne({ _id: new Types.ObjectId(uid) }).session(session);
        io.to(`coach:${pkg.coachId.toString()}`).emit("coach:newPackage", {
          memberName: user?.name ?? "",
          packageName: pkg.name,
          classesTotal: pkg.numberOfSessions,
          createdAt: new Date().toISOString(),
        });
      } else if (!io) {
        logger.warn("coach:newPackage skipped — io instance unavailable");
      }
      if (pkg.category !== "PERSONAL_TRAINING") {
        await sendPaymentToRentalSystem(payment);
      }
      });
  }

  static async subscribeToPackage(
    uid: string,
    pkgId: string,
    startDate: string,
    paymentMethod: string,
    merchantReferenceId?: string,
    promoCode?: string,
    note?: string,
  ) {
    let orderId: string;
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
        pkgId,
      });

    startDate = new Date(startDate).toISOString();
    const packageId = new Types.ObjectId(pkgId);
    const endDate = getPackageEndDate(startDate, pkg).toISOString();

    let restrictions: IClassRestrictionRecord[];
    if (pkg.classRestrictions) {
      restrictions = [];
      pkg.classRestrictions.forEach((cls) => {
        restrictions.push({
          cid: cls.cid,
          limit: cls.limit,
        });
      });
    }

    let price = pkg.price;
    if (promoCode) {
      const discountedPrice = await PromoCode.getDiscountedPrice(
        promoCode,
        pkg.price,
        "PACKAGE",
      );
      if (discountedPrice === null)
        throw new NotFoundError("PROMO_CODE_NOT_FOUND", "Promo code not found");
      price = discountedPrice;
    }

    if (merchantReferenceId && paymentMethod === "APP") {
      orderId = await PaymentsService.checkPayment(
        merchantReferenceId,
        price,
      );
    }

    await runInTransaction(async (session: ClientSession) => {
      const payment = await PaymentsService.savePayment(
        uid,
        price,
        paymentMethod,
        "PACKAGE",
        session,
        orderId,
        merchantReferenceId,
        undefined,
        packageId,
        undefined,
      );
      await Member.addPackage(
        uid,
        pkg._id.toString(),
        pkg.name,
        pkg.numberOfSessions,
        startDate,
        endDate,
        session,
        restrictions,
      );
      if (pkg.category !== "PERSONAL_TRAINING") {
        await sendPaymentToRentalSystem(payment);
      }
    });
  }

  static async addSavedPkgToMember(
    uid: string,
    pkgId: string,
    startDate: string,
    remainingClasses: number,
    savedEndDate?: string,
  ) {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
        pkgId,
      });
    startDate = new Date(startDate).toISOString();
    const endDate = savedEndDate
      ? savedEndDate
      : getPackageEndDate(startDate, pkg).toISOString();

    let restrictions: IClassRestrictionRecord[];
    if (pkg.classRestrictions) {
      restrictions = [];
      pkg.classRestrictions.forEach((cls) => {
        restrictions.push({
          cid: cls.cid,
          limit: cls.limit,
        });
      });
    }

    await runInTransaction(async (session: ClientSession) => {
      await Member.addPackage(
        uid,
        pkg._id.toString(),
        pkg.name,
        remainingClasses,
        startDate,
        endDate,
        session,
        restrictions,
      );
      logger.info("Added pkg");
    });
  }

  static async unsubscribeFromPackage(
    uid: string,
    pkgId: string,
    pkgStartDate: string,
  ) {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    await runInTransaction(async (session: ClientSession) => {
      await Member.removePackage(uid, pkgId, pkgStartDate, session);
    });
  }

  static async addNonUserPackage(
    name: string,
    phoneNumber: string,
    pkgId: string,
    pkgStartDate: string,
    paymentMethod: string,
    pendingDeduction: boolean,
    paymentDate?: string,
    amount?: string,
  ) {
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "The package was not found");
    pkgStartDate = new Date(pkgStartDate).toISOString();
    if (paymentDate) {
      paymentDate = new Date(paymentDate).toISOString();
    }
    const endDate = getPackageEndDate(pkgStartDate, pkg).toISOString();
    await runInTransaction(async (session: ClientSession) => {
      const payment = await PaymentsService.savePayment(
        undefined,
        amount || (pkg as any).price,
        paymentMethod,
        "NON_USER_PACKAGE",
        session,
        undefined,
        undefined,
        undefined,
        (pkg as any)._id,
        paymentDate ? paymentDate : undefined,
        undefined,
        name,
        phoneNumber,
      );
      logger.info("Payment Created: ", {
        paymentId: payment._id,
        amount: payment.amount,
      });
      const nonUserPackage = new NonUserPackage({
        name,
        pkgId,
        phoneNumber,
        pkgStartDate,
        pkgEndDate: endDate,
        remainingClasses: pendingDeduction
          ? (pkg as any).numberOfSessions - 1
          : (pkg as any).numberOfSessions,
        paymentId: payment._id,
        createdAt: new Date(),
      });
      await nonUserPackage.save({ session });
      if (pkg.category !== "PERSONAL_TRAINING") {
        await sendPaymentToRentalSystem(payment);
      }
    });
  }
}
