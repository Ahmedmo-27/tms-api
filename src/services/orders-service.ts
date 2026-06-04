import { ClientSession } from "mongoose";
import { NotFoundError } from "../core/ApiError";
import { ICartItem, IOrder } from "../models/order";
import Order from "../models/order";
import Product from "../models/product";
import { runInTransaction } from "../utils/transaction";

export class OrdersService {
  static async saveOrder(cart: any) {
    const orderData: IOrder = { cart: [], total: 0 };
    await runInTransaction(async (session: ClientSession) => {
      for (const item of cart) {
        const product = await Product.findOne({
          barcode: item.barcode,
        }).session(session);
        if (!product)
          throw new NotFoundError("PRODUCT_NOT_FOUND", "Product is not found");
        await Product.deductItem(item.barcode, item.quantity, session);
        let cartItem: ICartItem = {
          barcode: item.barcode,
          quantity: item.quantity,
        };
        orderData.total += product.price * item.quantity;
        orderData.cart.push(cartItem);
      }
      const order = await Order.create(orderData);
      return order;
    });
  }

  static async deleteOrder(orderId: string){
    await runInTransaction(async (session: ClientSession) => {
        const order = Order.findByIdAndDelete(orderId).session(session);
        for(const item of (order as any).cart) {
            const product = await Product.findOne({barcode: item.barcode}).session(session);
            if(!product) throw new NotFoundError("PRODUCT_NOT_FOUND", "Product is not found")
            await Product.returnItem(item.barcode, item.quantity, session);
        }
    })
  }
}
