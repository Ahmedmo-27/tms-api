import { ClientSession } from "mongoose";
import { OrdersService } from "./orders-service";
import Order from "../models/order";
import Product from "../models/product";
import { NotFoundError } from "../core/ApiError";

jest.mock("../models/order", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findByIdAndDelete: jest.fn(),
  },
}));

jest.mock("../models/product", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    deductItem: jest.fn(),
    returnItem: jest.fn(),
  },
}));

const mockSession = {} as ClientSession;
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn(async (fn) => fn(mockSession)),
}));

describe("OrdersService.deleteOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("successfully cancels an order and returns items to inventory with session", async () => {
    const mockOrder = {
      _id: "order123",
      cart: [
        { barcode: "BAR1", quantity: 2 },
        { barcode: "BAR2", quantity: 1 },
      ],
      total: 300,
    };

    const sessionQuery = {
      session: jest.fn().mockResolvedValue(mockOrder),
    };
    (Order.findByIdAndDelete as jest.Mock).mockReturnValue(sessionQuery);

    const productQuery1 = {
      session: jest.fn().mockResolvedValue({ barcode: "BAR1", item: "Item 1" }),
    };
    const productQuery2 = {
      session: jest.fn().mockResolvedValue({ barcode: "BAR2", item: "Item 2" }),
    };

    (Product.findOne as jest.Mock)
      .mockReturnValueOnce(productQuery1)
      .mockReturnValueOnce(productQuery2);

    await OrdersService.deleteOrder("order123");

    expect(Order.findByIdAndDelete).toHaveBeenCalledWith("order123");
    expect(sessionQuery.session).toHaveBeenCalledWith(mockSession);

    expect(Product.findOne).toHaveBeenNthCalledWith(1, { barcode: "BAR1" });
    expect(productQuery1.session).toHaveBeenCalledWith(mockSession);
    expect(Product.returnItem).toHaveBeenNthCalledWith(1, "BAR1", 2, mockSession);

    expect(Product.findOne).toHaveBeenNthCalledWith(2, { barcode: "BAR2" });
    expect(productQuery2.session).toHaveBeenCalledWith(mockSession);
    expect(Product.returnItem).toHaveBeenNthCalledWith(2, "BAR2", 1, mockSession);
  });

  it("throws NotFoundError when order does not exist", async () => {
    const sessionQuery = {
      session: jest.fn().mockResolvedValue(null),
    };
    (Order.findByIdAndDelete as jest.Mock).mockReturnValue(sessionQuery);

    await expect(OrdersService.deleteOrder("nonexistent_id")).rejects.toThrow(NotFoundError);
    await expect(OrdersService.deleteOrder("nonexistent_id")).rejects.toThrow("Order is not found");
  });

  it("throws NotFoundError when a cart item product is not found", async () => {
    const mockOrder = {
      _id: "order123",
      cart: [{ barcode: "MISSING_BARCODE", quantity: 1 }],
      total: 100,
    };

    const sessionQuery = {
      session: jest.fn().mockResolvedValue(mockOrder),
    };
    (Order.findByIdAndDelete as jest.Mock).mockReturnValue(sessionQuery);

    const productQuery = {
      session: jest.fn().mockResolvedValue(null),
    };
    (Product.findOne as jest.Mock).mockReturnValue(productQuery);

    await expect(OrdersService.deleteOrder("order123")).rejects.toThrow(NotFoundError);
    await expect(OrdersService.deleteOrder("order123")).rejects.toThrow("Product is not found");
    expect(Product.returnItem).not.toHaveBeenCalled();
  });
});
