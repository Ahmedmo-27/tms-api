import { Schema, model, Document, Model } from "mongoose";

export interface IPromoCode extends Document {
  code: string;
  appliesTo: "PACKAGE" | "CLASS" | "ALL";
  discountType: "PERCENTAGE" | "FIXED";
  discount: number;
  startDate: Date;
  endDate: Date;
}

export interface IPromoCodeMethods {}

export interface IPromoCodeStatics {
  getDiscountedPrice(
    code: string,
    price: number,
    type: "PACKAGE" | "CLASS"
  ): Promise<number | null>;
}

type IPromoCodeModel = Model<IPromoCode, {}, IPromoCodeMethods> &
  IPromoCodeStatics;

const promoCodeSchema = new Schema<IPromoCode, IPromoCodeModel, IPromoCodeMethods>(
  {
    code: { type: String, required: true },
    appliesTo: {
      type: String,
      required: true,
      enum: ["PACKAGE", "CLASS", "ALL"],
    },
    discountType: {
      type: String,
      required: true,
      enum: ["PERCENTAGE", "FIXED"],
    },
    discount: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true } // optional, adds createdAt & updatedAt
);

promoCodeSchema.statics.getDiscountedPrice = async function (
  code: string,
  price: number,
  type: "PACKAGE" | "CLASS"
) {
  const promo = await this.findOne({
    code,
    startDate: { $lte: new Date() },
    endDate: { $gte: new Date() },
  });
  if (!promo) return null;

  if (type === "PACKAGE") {
    if (promo.appliesTo !== "PACKAGE" && promo.appliesTo !== "ALL") return null;
  } else if (type === "CLASS") {
    if (promo.appliesTo !== "CLASS" && promo.appliesTo !== "ALL") return null;
  }

  let discounted = price;
  if (promo.discountType === "PERCENTAGE") {
    discounted = price - (price * promo.discount) / 100;
  } else if (promo.discountType === "FIXED") {
    discounted = price - promo.discount;
  }

  return Math.max(0, discounted);
};

const PromoCode = model<IPromoCode, IPromoCodeModel>(
  "PromoCode",
  promoCodeSchema
);

export default PromoCode;
