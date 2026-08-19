import asyncHandler from "../../utils/asyncHandler";
import Product from "../../models/product";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { Request, Response } from "express";

export const getProducts = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const products = await Product.find();
  new SuccessResponse("Products Found!", products).send(res);
});

export const addProduct = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { barcode, brand, item, price, quantity } = req.body;
  if (!barcode || !brand || !item || price == null || quantity == null) {
    throw new BadRequestError(
      "INVALID_REQUEST",
      "barcode, brand, item, price, and quantity are required",
    );
  }
  const product = new Product({ barcode, brand, item, price, quantity });
  await product.save();
  new SuccessResponse("Product Created!", product).send(res);
});

export const editProduct = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const barcode = req.params.barcode;
  const { brand, item, price, quantity } = req.body;
  const update: Record<string, unknown> = {};
  if (brand !== undefined) update.brand = brand;
  if (item !== undefined) update.item = item;
  if (price !== undefined) update.price = price;
  if (quantity !== undefined) update.quantity = quantity;
  if (Object.keys(update).length === 0) {
    throw new BadRequestError("INVALID_UPDATES", "No valid fields to update");
  }
  const product = await Product.findOneAndUpdate({ barcode }, update, {
    new: true,
  });
  if (!product) {
    throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found");
  }
  new SuccessResponse("Product Updated!", product).send(res);
});

export const deleteProduct = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const barcode = req.params.barcode;
  const product = await Product.findOneAndDelete({ barcode });
  if (!product) {
    throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found");
  }
  new SuccessResponse("Product Deleted!", product).send(res);
});
