import { Request, Response } from "express";
import Location from "../../models/location";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { getAssignedBranchLocationId } from "../../utils/location-scope";

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
