import asyncHandler from "../../utils/asyncHandler";
import Product from "../../models/product";
import { SuccessResponse } from "../../core/ApiResponse";
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
  const productData = req.body;
  const product = new Product(productData)
  await product.save()
  new SuccessResponse("Product Created!", product).send(res);
});

export const editProduct = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const barcode = req.params.barcode;
  const updatedProduct = req.body
  await Product.findOneAndUpdate({barcode}, updatedProduct)
  new SuccessResponse("Product Updated!").send(res);
});
export const deleteProduct = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const barcode = req.params.barcode;
  const product = await Product.findOneAndDelete({barcode})
  new SuccessResponse("Product Deleted!", product).send(res);
});
