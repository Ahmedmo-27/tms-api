import mongoose, { Schema, Model, Types } from "mongoose";
import logger from "../config/logger";
import Class from "./class";

const UNLIMITED_SPACE_CATEGORIES = new Set([
  "OPEN_GYM",
  "SPACE_MEMBERSHIP",
  "ULTIMATE_MINDSPACER",
]);

export function isUnlimitedSpaceAccess(category: string): boolean {
  return UNLIMITED_SPACE_CATEGORIES.has(category);
}

export function spaceAccessPriority(category: string): number {
  switch (category) {
    case "OPEN_GYM":
      return 0;
    case "SPACE_MEMBERSHIP":
      return 1;
    case "ULTIMATE_MINDSPACER":
      return 2;
    case "MIXED":
      return 3;
    default:
      return 99;
  }
}

export type OpenGymRenewalPeriod =
  | "WEEKLY"
  | "BIWEEKLY"
  | "TRIWEEKLY"
  | "MONTHLY"
  | "BIMONTHLY"
  | "TRIMONTHLY";

export const OPEN_GYM_RENEWAL_DAYS: Record<OpenGymRenewalPeriod, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  TRIWEEKLY: 21,
  MONTHLY: 30,
  BIMONTHLY: 60,
  TRIMONTHLY: 90,
};

export const OPEN_GYM_RENEWAL_PERIOD_VALUES = Object.keys(
  OPEN_GYM_RENEWAL_DAYS,
) as OpenGymRenewalPeriod[];

export function isOpenGymRenewalPeriod(
  value: string,
): value is OpenGymRenewalPeriod {
  return value in OPEN_GYM_RENEWAL_DAYS;
}

export function resolvePackageExpiryDays(pkg: {
  expiryPeriod: number;
}): number {
  return pkg.expiryPeriod;
}

export function getPackageEndDate(
  startDate: string | Date,
  pkg: {
    category: string;
    renewalPeriod?: OpenGymRenewalPeriod;
    expiryPeriod: number;
  },
): Date {
  const days = resolvePackageExpiryDays(pkg);
  return new Date(new Date(startDate).getTime() + days * 24 * 60 * 60 * 1000);
}

export interface IClassRestriction {
  cid: Types.ObjectId;
  limit: number;
}

export interface IPackage {
  name: string;
  numberOfSessions: number;
  category: string;
  price: number;
  expiryPeriod: number;
  renewalPeriod?: OpenGymRenewalPeriod;
  locationId?: Types.ObjectId;
  coachId?: string;
  hidden?: boolean;
  classRestrictions?: IClassRestriction[];
  opensClasses: Types.ObjectId[];
}

export interface IPackageMethods {}

export interface IPackageStatics {
  getClassPackages(cid: string, location: string): Promise<string[]>;
  getSpaceWalkPackageIds(): Promise<string[]>;
}

type IPackageModel = Model<IPackage, {}, IPackageMethods> & IPackageStatics;

const classRestrictionsSchema = new Schema<IClassRestriction>({
  cid: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  limit: {
    type: Number,
    required: true,
  },
});

const PackageSchema = new Schema<IPackage, IPackageModel, IPackageMethods>({
  name: {
    type: String,
    required: true,
  },
  numberOfSessions: {
    type: Number,
    default: 10000,
  },
  price: {
    type: Number,
    required: true,
  },
  expiryPeriod: {
    type: Number,
    required: true,
  },
  renewalPeriod: {
    type: String,
    enum: OPEN_GYM_RENEWAL_PERIOD_VALUES,
    required: false,
  },
  category: {
    type: String,
    required: true,
    enum: [
      "FUNCTIONAL_TRAINING",
      "STUDIO",
      "PERSONAL_TRAINING",
      "PRE_POST_NATAL",
      "MIXED",
      "SPACE_MEMBERSHIP",
      "ULTIMATE_MINDSPACER",
      "OPEN_GYM",
    ],
  },
  opensClasses: {
    type: [Schema.Types.ObjectId],
    ref: "Class",
  },
  locationId: {
    type: Schema.Types.ObjectId,
    ref: "Location",
    required: false,
    default: null,
  },
  hidden: {
    type: Boolean,
    required: false,
  },
  coachId: {
    type: Schema.Types.ObjectId,
    ref: "Coach",
    required: false,
  },
  classRestrictions: [classRestrictionsSchema],
});

PackageSchema.static(
  "getSpaceWalkPackageIds",
  async function (): Promise<string[]> {
    const workspaceClasses = await Class.find({ category: "WORKSPACE" }).select(
      "_id",
    );
    const workspaceClassIds = workspaceClasses.map((cls) => cls._id);

    const eligibility: Record<string, unknown>[] = [
      { category: "ULTIMATE_MINDSPACER" },
      { category: "SPACE_MEMBERSHIP" },
      { category: "OPEN_GYM" },
      { category: "MIXED", name: /space/i },
    ];
    if (workspaceClassIds.length > 0) {
      eligibility.push({ opensClasses: { $in: workspaceClassIds } });
    }

    const pkgs = await Package.find({ $or: eligibility });
    return [...new Set(pkgs.map((pkg) => pkg._id.toString()))];
  }
);

PackageSchema.static(
  "getClassPackages",
  async function (cid: any, location: string): Promise<string[]> {
    const pkgs = await Package.find({
      opensClasses: new Types.ObjectId(cid.toString()),
    });
    const ultimateName = "Ultimate Mindspacer " + location;
    const ultimatePkgs = await Package.find({ name: ultimateName });
    const pkgIds = ultimatePkgs.map((pkg) => pkg._id.toString());
    pkgs.forEach((pkg) => pkgIds.push(pkg._id.toString()));
    return pkgIds;
  }
);

const Package = mongoose.model<IPackage, IPackageModel>(
  "Package",
  PackageSchema
);

export default Package;
