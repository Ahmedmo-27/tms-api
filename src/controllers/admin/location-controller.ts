import { Request, Response } from "express";
import Location from "../../models/location";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { getAssignedBranchLocationId, resolveLocationFilter } from "../../utils/location-scope";

export const addLocation = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { branchName, location, locationUrl } = req.body;
    const loc = new Location({ branchName, location, locationUrl });
    await loc.save();
    new SuccessResponse("Location Added!", loc).send(res);
  }
);

export const getLocation = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const branchLocationId = getAssignedBranchLocationId(req);
    if (branchLocationId) {
      const location = await Location.findById(branchLocationId);
      new SuccessResponse(
        "Locations Found!",
        location ? [location] : []
      ).send(res);
      return;
    }
    const locations = await Location.find();
    new SuccessResponse("Locations Found!", locations).send(res);
  }
);

export const updateLocation = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchName, location, locationUrl } = req.body;
    const loc = await Location.findByIdAndUpdate(id, { branchName, location, locationUrl }, { new: true });
    if (!loc) throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found", { id });
    new SuccessResponse("Location Updated!", loc).send(res);
  }
);

export const deleteLocation = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const loc = await Location.findByIdAndDelete(id);
    if (!loc) throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found", { id });
    new SuccessResponse("Location Deleted!", loc).send(res);
  }
);

export const getPaymentsPin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const locationId = (req.query.locationId as string) || resolveLocationFilter(req);
    if (locationId) {
      const loc = await Location.findById(locationId);
      if (!loc) throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found");
      new SuccessResponse("Payments PIN Found", {
        locationId: loc._id,
        branchName: loc.branchName,
        pin: loc.paymentsPin || "1967",
      }).send(res);
      return;
    }

    const locations = await Location.find().select("branchName location paymentsPin");
    new SuccessResponse("Locations Payments PINs Found", {
      defaultPin: "1967",
      locations: locations.map((l) => ({
        locationId: l._id,
        branchName: l.branchName,
        pin: l.paymentsPin || "1967",
      })),
    }).send(res);
  }
);

export const updatePaymentsPin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { pin, locationId, applyToAll } = req.body;
    if (!pin || typeof pin !== "string" || !/^\d{4,8}$/.test(pin.trim())) {
      throw new BadRequestError("INVALID_PIN", "PIN must be between 4 and 8 digits");
    }

    const cleanPin = pin.trim();

    if (applyToAll || !locationId) {
      await Location.updateMany({}, { paymentsPin: cleanPin });
      new SuccessResponse("Payments PIN updated for all branches", { pin: cleanPin }).send(res);
      return;
    }

    const loc = await Location.findByIdAndUpdate(
      locationId,
      { paymentsPin: cleanPin },
      { new: true }
    );
    if (!loc) throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found");
    new SuccessResponse(`Payments PIN updated for ${loc.branchName}`, {
      locationId: loc._id,
      branchName: loc.branchName,
      pin: loc.paymentsPin,
    }).send(res);
  }
);

export const verifyPaymentsPin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { pin } = req.body;
    if (!pin || typeof pin !== "string") {
      throw new BadRequestError("PIN_REQUIRED", "PIN is required");
    }

    const locationId = resolveLocationFilter(req) || (req.body.locationId as string);
    let expectedPin = "1967";

    if (locationId) {
      const loc = await Location.findById(locationId);
      if (loc?.paymentsPin) {
        expectedPin = loc.paymentsPin;
      }
    } else {
      const firstLoc = await Location.findOne({ paymentsPin: { $exists: true } });
      if (firstLoc?.paymentsPin) {
        expectedPin = firstLoc.paymentsPin;
      }
    }

    const verified = pin.trim() === expectedPin.trim();
    new SuccessResponse("PIN verification result", { verified }).send(res);
  }
);
