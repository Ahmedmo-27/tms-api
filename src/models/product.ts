import mongoose, {
  Document,
  Schema,
  Types,
  ClientSession,
  Model,
} from "mongoose";
import { ConflictError, NotFoundError } from "../core/ApiError";

export interface IProduct extends Document {
  barcode: string;
  brand: string;
  item: string;
  price: number;
  quantity: number;
}

interface IProductStatics {
  deductItem(
    barcode: string,
    quantity: number,
    session: ClientSession
  ): Promise<void>;
  returnItem(
    barcode: string,
    quantity: number,
    session: ClientSession
  ): Promise<void>;
}

type ProductModel = Model<IProduct> & IProductStatics;

const ProductSchema: Schema<IProduct, ProductModel> = new Schema({
  barcode: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  brand: {
    type: String,
    required: true,
  },
  item: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
});

ProductSchema.static(
  "deductItem",
  async function (
    barcode: string,
    quantity: number,
    session: ClientSession
  ): Promise<void> {
    const product = await this.findOne({ barcode });
    if (!product)
      throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found");
    if ((product.quantity - quantity) < 0)
      throw new ConflictError("OUT_OF_STOCK", "Product is out of stock");
    await this.updateOne(
      {
        barcode,
        quantity: { $gte: quantity },
      },
      {
        $inc: { quantity: -quantity },
      },
      {
        session,
      }
    );
  }
);

ProductSchema.static(
  "returnItem",
  async function (
    barcode: string,
    quantity: number,
    session: ClientSession
  ): Promise<void> {
    const product = await this.findOne({ barcode }).session(session);
    if (!product)
      throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found");
    await this.updateOne(
      {
        barcode,
      },
      {
        $inc: { quantity: quantity },
      },
      {
        session,
      }
    );
  }
);

const Product = mongoose.model<IProduct, ProductModel>(
  "Product",
  ProductSchema
);

export default Product;
