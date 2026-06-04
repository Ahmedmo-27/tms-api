import mongoose, {
  Schema,
  Document,
  Model,
  Types,
  ClientSession,
} from "mongoose";
import { ConflictError, NotFoundError } from "../core/ApiError";
import { timeStamp } from "console";

export interface ICartItem {
  barcode: string;
  quantity: number;
}

export interface IOrder {
  cart: ICartItem[];
  total: number;
}

interface IOrderStatics {
  addItem(
    orderId: string,
    barcode: string,
    price: number,
    quantity: number,
    session: ClientSession
  ): Promise<void>;
  removeItem(
    orderId: string,
    barcode: string,
    session: ClientSession
  ): Promise<void>;
  decrementItem(
    orderId: string,
    barcode: string,
    price: number,
    quantity: number,
    session: ClientSession
  ): Promise<void>;
}

type OrderModel = Model<IOrder> & IOrderStatics;

const CartItemSchema = new Schema<ICartItem>(
  {
    barcode: { type: String, required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false }
);

const OrderSchema: Schema<IOrder, OrderModel> = new Schema(
  {
    cart: {
      type: [CartItemSchema],
      required: true,
      default: [],
    },
    total: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

OrderSchema.static(
  "addItem",
  async function (
    orderId: string,
    barcode: string,
    price: number,
    quantity: number,
    session: ClientSession
  ): Promise<void> {
    const order = await this.findById(orderId).session(session);
    if (!order) {
      throw new NotFoundError("ORDER_NOT_FOUND", "Order not found");
    }

    const existingItem = order.cart.find((item) => item.barcode === barcode);

    if (existingItem) {
      await this.updateOne(
        { _id: orderId },
        {
          $inc: {
            total: price * quantity,
            "cart.$[item].quantity": quantity,
          },
        },
        {
          arrayFilters: [{ "item.barcode": barcode }],
          session,
        }
      );
    } else {
      await this.updateOne(
        { _id: orderId },
        {
          $inc: { total: price * quantity },
          $push: {
            cart: { barcode, quantity },
          },
        },
        { session }
      );
    }
  }
);

OrderSchema.static(
  "removeItem",
  async function (
    orderId: string,
    barcode: string,
    price: number,
    quantity: number,
    session: ClientSession
  ): Promise<void> {
    const order = await this.findById(orderId).session(session);
    if (!order) {
      throw new NotFoundError("ORDER_NOT_FOUND", "Order not found");
    }

    const existingItem = order.cart.find((item) => item.barcode === barcode);

    if (!existingItem) {
      throw new NotFoundError("ITEM_NOT_FOUND", "Item not found in order");
    }

    await this.updateOne(
      { _id: orderId },
      {
        $inc: { total: -quantity * price },
        $pull: { cart: { barcode } },
      },
      { session }
    );
  }
);

OrderSchema.static(
  "decrementItem",
  async function (
    orderId: string,
    barcode: string,
    price: number,
    quantity: number,
    session: ClientSession
  ): Promise<void> {
    const order = await this.findById(orderId).session(session);
    if (!order) {
      throw new NotFoundError("ORDER_NOT_FOUND", "Order not found");
    }

    const existingItem = order.cart.find((item) => item.barcode === barcode);

    if (!existingItem) {
      throw new NotFoundError("ITEM_NOT_FOUND", "Item not found in order");
    }

    await this.updateOne(
      { _id: orderId },
      {
        $inc: { total: -quantity * price },
        $set: { "cart.$[item].quantity": existingItem.quantity - quantity },
      },
      {
        arrayFilters: [{ "item.barcode": barcode }],
        session,
      }
    );
  }
);

const Order = mongoose.model<IOrder, OrderModel>("Order", OrderSchema);

export default Order;
