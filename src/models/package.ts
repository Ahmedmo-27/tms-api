import mongoose, { Schema, Model, Types } from "mongoose";
import logger from "../config/logger";

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
  coachId?: string;
  hidden?: boolean;
  classRestrictions?: IClassRestriction[];
  opensClasses: Types.ObjectId[];
}

export interface IPackageMethods {}

export interface IPackageStatics {
  getClassPackages(cid: string, location: string): Promise<string[]>;
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
      "ULTIMATE_MINDSPACER"
    ],
  },
  opensClasses: {
    type: [Schema.Types.ObjectId],
    ref: "Class",
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
