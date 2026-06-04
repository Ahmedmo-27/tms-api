import mongoose, {
  Document,
  Schema,
  Types,
  Model,
} from "mongoose";

export interface INonUserPackage extends Document {
  name: string;
  phoneNumber: string;
  pkgId: Types.ObjectId;
  pkgStartDate: Date;
  pkgEndDate: Date;
  remainingClasses: number;
  createdAt: Date;
  paymentId: Types.ObjectId;
  added: boolean;
}

type INonUserPackageModel = Model<INonUserPackage> & {};

const NonUserPackageSchema: Schema<INonUserPackage, INonUserPackageModel> = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    pkgId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Package",
    },
    pkgStartDate: {
      type: Date,
      required: true,
    },
    pkgEndDate: {
      type: Date,
      required: true,
    },
    remainingClasses: {
      type: Number,
      required: true,
    },
    paymentId: {
        type: Schema.Types.ObjectId,
        required: false,
    },
    added: {
      type: Boolean,
      default: false,
    }
  },
);

const NonUserPackage = mongoose.model<INonUserPackage, INonUserPackageModel>(
  "NonUserPackage",
  NonUserPackageSchema
);

export default NonUserPackage;
