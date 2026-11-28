import { Types } from "mongoose";
import * as XLSX from "xlsx";
import User from "../models/user";
import Member from "../models/member";
import Payment from "../models/payment";
import Package from "../models/package";
import {
  formatCairoDate,
  isPackagePayment,
} from "./payments-national-id-export";

export interface SalesmanPaymentRow {
  "Payment Date (Cairo)": string;
  Salesman: string;
  "Amount (EGP)": number;
  "Payment Method": string;
  "Package Name": string;
  "Member Name": string;
  "Phone Number": string;
  Email: string;
  "National ID": string;
}

export interface SalesmanPaymentsSummary {
  totalPayments: number;
  totalExportedAmountEGP: number;
  salesmanTotals: Map<string, { count: number; amount: number }>;
}

export function createSalesmanPaymentsWorkbook(
  rows: SalesmanPaymentRow[],
  sheetName = "Salesman Payments"
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [{ Notice: "No package payments found for this period" }]
  );

  if (rows.length > 0) {
    const keys = Object.keys(rows[0]) as Array<keyof SalesmanPaymentRow>;
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

export async function buildSalesmanPaymentsExport(params: {
  startDate: Date;
  endDate: Date;
  sheetName?: string;
}): Promise<{
  workbook: XLSX.WorkBook;
  rows: SalesmanPaymentRow[];
  summary: SalesmanPaymentsSummary;
}> {
  const { startDate, endDate, sheetName = "Salesman Payments" } = params;

  const rawPayments = await Payment.find({
    paymentTime: { $gte: startDate, $lt: endDate },
    paymentMethod: { $ne: "DEDUCTED" },
    purpose: { $nin: ["DROPIN", "WALKIN", "NON_USER_BOOKING", "ONLINE_CLASS"] },
  })
    .select(
      "uid nonMemberName nonMemberPhone amount paymentMethod paymentTime pkgId note purpose"
    )
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
      ? User.find({ $or: userOrConditions })
          .select("_id name phoneNumber email nationalId")
          .lean()
      : Promise.resolve([]),
    pkgIds.length > 0
      ? Package.find({ _id: { $in: pkgIds } })
          .select("name")
          .lean()
      : Promise.resolve([]),
  ]);

  const resolvedUserIds = usersList.map((u) => new Types.ObjectId(String(u._id)));

  const membersList =
    resolvedUserIds.length > 0
      ? await Member.find({ uid: { $in: resolvedUserIds } })
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

  const userById = new Map(usersList.map((u) => [String(u._id), u]));
  const userByPhone = new Map(
    usersList
      .filter((u) => Boolean(u.phoneNumber))
      .map((u) => [String(u.phoneNumber).trim(), u])
  );
  const memberByUid = new Map(membersList.map((m) => [String(m.uid), m]));
  const sellerById = new Map(sellersList.map((s) => [String(s._id), s]));
  const packageById = new Map(
    packagesList.map((pkg: any) => [String(pkg._id), pkg])
  );

  const salesmanTotals = new Map<string, { count: number; amount: number }>();
  let totalExportedAmountEGP = 0;
  const rows: SalesmanPaymentRow[] = [];

  for (const p of payments) {
    const user =
      (p.uid ? userById.get(String(p.uid)) : undefined) ||
      (p.nonMemberPhone
        ? userByPhone.get(String(p.nonMemberPhone).trim())
        : undefined);

    const uidStr = user ? String(user._id) : null;

    let packageName = "N/A";
    if (p.pkgId) {
      const pkg = packageById.get(String(p.pkgId));
      packageName = pkg?.name || `Package (${String(p.pkgId)})`;
    } else if (p.note) {
      packageName = p.note;
    } else if (p.purpose) {
      packageName = p.purpose;
    }

    let salesman = "Unassigned";
    if (uidStr) {
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
    }

    const amount = Number(p.amount) || 0;
    totalExportedAmountEGP += amount;

    const currentTotal = salesmanTotals.get(salesman) || { count: 0, amount: 0 };
    currentTotal.count += 1;
    currentTotal.amount += amount;
    salesmanTotals.set(salesman, currentTotal);

    rows.push({
      "Payment Date (Cairo)": formatCairoDate(p.paymentTime),
      Salesman: salesman,
      "Amount (EGP)": amount,
      "Payment Method": p.paymentMethod || "N/A",
      "Package Name": packageName,
      "Member Name": user?.name || p.nonMemberName || "N/A",
      "Phone Number": user?.phoneNumber || p.nonMemberPhone || "N/A",
      Email: user?.email || "N/A",
      "National ID": user?.nationalId ? String(user.nationalId).trim() : "",
    });
  }

  const workbook = createSalesmanPaymentsWorkbook(rows, sheetName);

  return {
    workbook,
    rows,
    summary: {
      totalPayments: rows.length,
      totalExportedAmountEGP,
      salesmanTotals,
    },
  };
}
