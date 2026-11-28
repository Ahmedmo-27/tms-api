import { Types } from "mongoose";
import * as XLSX from "xlsx";
import { formatInTimeZone } from "date-fns-tz";
import User from "../models/user";
import Member from "../models/member";
import Payment from "../models/payment";
import Package from "../models/package";
import { CAIRO_TZ } from "../utils/timezone";

export interface PaymentNationalIdRow {
  "Payment Date (Cairo)": string;
  "Amount (EGP)": number;
  "Payment Method": string;
  "Package Name": string;
  Salesman: string;
  "National ID": string;
  "Member Name": string;
  "Phone Number": string;
  Email: string;
}

export interface PaymentsNationalIdSummary {
  cairoStart: string;
  cairoEnd: string;
  totalPaymentsInRange: number;
  exportedRowsCount: number;
  matchedUsersCount: number;
  totalExportedAmountEGP: number;
}

export function hasValidNationalId(nationalId: unknown): boolean {
  if (!nationalId) return false;
  const clean = String(nationalId).trim();
  if (!clean || clean === "null" || clean === "undefined") return false;
  return true;
}

export function isPackagePayment(payment: {
  purpose?: string | null;
  pkgId?: unknown;
}): boolean {
  if (!payment) return false;
  const purpose = String(payment.purpose || "").toUpperCase();
  if (
    purpose === "DROPIN" ||
    purpose === "WALKIN" ||
    purpose === "NON_USER_BOOKING" ||
    purpose === "ONLINE_CLASS"
  ) {
    return false;
  }
  return (
    purpose === "PACKAGE" ||
    purpose === "NON_USER_PACKAGE" ||
    Boolean(payment.pkgId)
  );
}

export function formatCairoDate(date: Date | string | undefined | null): string {
  if (!date) return "";
  try {
    return formatInTimeZone(new Date(date), CAIRO_TZ, "yyyy-MM-dd HH:mm:ss");
  } catch {
    return new Date(date).toISOString();
  }
}

export function createPaymentsNationalIdWorkbook(
  rows: PaymentNationalIdRow[],
  sheetName = "Payments National ID"
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [{ Notice: "No package payments with National ID found for this period" }]
  );

  if (rows.length > 0) {
    const keys = Object.keys(rows[0]) as Array<keyof PaymentNationalIdRow>;
    ws["!cols"] = keys.map((key) => {
      let maxLen = String(key).length;
      for (const row of rows) {
        const val = row[key];
        const valLen = val !== undefined && val !== null ? String(val).length : 0;
        if (valLen > maxLen) maxLen = valLen;
      }
      return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
    });
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return wb;
}

export async function buildPaymentsNationalIdExport(params: {
  startDate: Date;
  endDate: Date;
  sheetName?: string;
}): Promise<{
  workbook: XLSX.WorkBook;
  rows: PaymentNationalIdRow[];
  summary: PaymentsNationalIdSummary;
}> {
  const { startDate, endDate, sheetName = "Payments National ID" } = params;

  const rawPayments = await Payment.find({
    paymentTime: { $gte: startDate, $lt: endDate },
    paymentMethod: { $ne: "DEDUCTED" },
    purpose: { $nin: ["DROPIN", "WALKIN", "NON_USER_BOOKING", "ONLINE_CLASS"] },
  })
    .select("uid nonMemberPhone amount paymentMethod paymentTime pkgId note purpose")
    .sort({ paymentTime: 1 })
    .lean();

  const payments = rawPayments.filter((p) => isPackagePayment(p));

  const userIds = Array.from(
    new Set(
      payments
        .map((p) => (p.uid ? String(p.uid) : null))
        .filter((id): id is string => Boolean(id))
    )
  ).map((id) => new Types.ObjectId(id));

  const nonMemberPhones = Array.from(
    new Set(
      payments
        .map((p) => (p.nonMemberPhone ? String(p.nonMemberPhone).trim() : null))
        .filter((phone): phone is string => Boolean(phone))
    )
  );

  const pkgIds = Array.from(
    new Set(
      payments
        .map((p) => (p.pkgId ? String(p.pkgId) : null))
        .filter((id): id is string => Boolean(id))
    )
  ).map((id) => new Types.ObjectId(id));

  const userOrConditions: Array<Record<string, unknown>> = [];
  if (userIds.length > 0) userOrConditions.push({ _id: { $in: userIds } });
  if (nonMemberPhones.length > 0) {
    userOrConditions.push({ phoneNumber: { $in: nonMemberPhones } });
  }

  const [usersList, packagesList] = await Promise.all([
    userOrConditions.length > 0
      ? User.find({
          $or: userOrConditions,
          nationalId: { $exists: true, $ne: null, $nin: ["", "null", "undefined"] },
        })
          .select("_id name phoneNumber email nationalId")
          .lean()
      : Promise.resolve([]),
    pkgIds.length > 0
      ? Package.find({ _id: { $in: pkgIds } })
          .select("name")
          .lean()
      : Promise.resolve([]),
  ]);

  const validUsers = usersList.filter((u) => hasValidNationalId(u.nationalId));
  const validUserIds = validUsers.map((u) => new Types.ObjectId(String(u._id)));

  const membersList =
    validUserIds.length > 0
      ? await Member.find({ uid: { $in: validUserIds } })
          .select("uid packages.pkgId packages.pkgStartDate packages.soldBy")
          .lean()
      : [];

  const sellerIds = Array.from(
    new Set(
      membersList.flatMap((m) =>
        (Array.isArray(m.packages) ? m.packages : [])
          .map((pkg) => (pkg?.soldBy ? String(pkg.soldBy) : null))
          .filter((id): id is string => Boolean(id))
      )
    )
  ).map((id) => new Types.ObjectId(id));

  const sellersList =
    sellerIds.length > 0
      ? await User.find({ _id: { $in: sellerIds } })
          .select("name")
          .lean()
      : [];

  const userById = new Map(validUsers.map((u) => [String(u._id), u]));
  const userByPhone = new Map(
    validUsers
      .filter((u) => Boolean(u.phoneNumber))
      .map((u) => [String(u.phoneNumber).trim(), u])
  );
  const memberByUid = new Map(membersList.map((m) => [String(m.uid), m]));
  const sellerById = new Map(sellersList.map((s) => [String(s._id), s]));
  const packageById = new Map(
    packagesList.map((pkg: any) => [String(pkg._id), pkg])
  );

  const matchedUserIds = new Set<string>();
  let totalExportedAmountEGP = 0;
  const rows: PaymentNationalIdRow[] = [];

  for (const p of payments) {
    const user =
      (p.uid ? userById.get(String(p.uid)) : undefined) ||
      (p.nonMemberPhone
        ? userByPhone.get(String(p.nonMemberPhone).trim())
        : undefined);

    if (!user) continue;

    const uidStr = String(user._id);
    matchedUserIds.add(uidStr);

    let packageName = "N/A";
    if (p.pkgId) {
      const pkg = packageById.get(String(p.pkgId));
      packageName = pkg?.name || `Package (${String(p.pkgId)})`;
    } else if (p.note) {
      packageName = p.note;
    } else if (p.purpose) {
      packageName = p.purpose;
    }

    let salesman = "N/A";
    const memberDoc = memberByUid.get(uidStr);
    const memberPackages = Array.isArray(memberDoc?.packages)
      ? memberDoc.packages
      : [];

    let resolvedSoldBy: unknown = null;
    if (p.pkgId && memberPackages.length > 0) {
      const matchingPackages = memberPackages.filter(
        (mp) => String(mp.pkgId) === String(p.pkgId)
      );
      if (matchingPackages.length > 0) {
        const paymentMs = p.paymentTime ? new Date(p.paymentTime).getTime() : 0;
        let bestPkg = matchingPackages[0];
        let bestDiff = Math.abs(
          new Date(bestPkg.pkgStartDate).getTime() - paymentMs
        );
        for (let i = 1; i < matchingPackages.length; i++) {
          const diff = Math.abs(
            new Date(matchingPackages[i].pkgStartDate).getTime() - paymentMs
          );
          if (diff < bestDiff) {
            bestDiff = diff;
            bestPkg = matchingPackages[i];
          }
        }
        resolvedSoldBy = bestPkg.soldBy || null;
      }
    }

    if (!resolvedSoldBy && memberPackages.length > 0) {
      const packagesWithSeller = memberPackages
        .filter((mp) => Boolean(mp.soldBy))
        .sort(
          (a, b) =>
            new Date(b.pkgStartDate).getTime() -
            new Date(a.pkgStartDate).getTime()
        );
      if (packagesWithSeller.length > 0) {
        resolvedSoldBy = packagesWithSeller[0].soldBy;
      }
    }

    if (resolvedSoldBy) {
      const seller = sellerById.get(String(resolvedSoldBy));
      salesman = seller?.name || `User (${String(resolvedSoldBy)})`;
    }

    const amount = Number(p.amount) || 0;
    totalExportedAmountEGP += amount;

    rows.push({
      "Payment Date (Cairo)": formatCairoDate(p.paymentTime),
      "Amount (EGP)": amount,
      "Payment Method": p.paymentMethod || "N/A",
      "Package Name": packageName,
      Salesman: salesman,
      "National ID": String(user.nationalId).trim(),
      "Member Name": user.name || "N/A",
      "Phone Number": user.phoneNumber || "N/A",
      Email: user.email || "N/A",
    });
  }

  const workbook = createPaymentsNationalIdWorkbook(rows, sheetName);

  return {
    workbook,
    rows,
    summary: {
      cairoStart: formatCairoDate(startDate),
      cairoEnd: formatCairoDate(endDate),
      totalPaymentsInRange: payments.length,
      exportedRowsCount: rows.length,
      matchedUsersCount: matchedUserIds.size,
      totalExportedAmountEGP,
    },
  };
}
