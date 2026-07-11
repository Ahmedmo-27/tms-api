import { Types } from "mongoose";
import Location from "../models/location";

export function memberPackageGrantsAccessAtLocation(
  memberPackageLocationId: Types.ObjectId | undefined | null,
  catalogPackageLocationId: Types.ObjectId | undefined | null,
  scanLocationId: string,
): boolean {
  if (memberPackageLocationId) {
    return memberPackageLocationId.toString() === scanLocationId;
  }
  if (catalogPackageLocationId) {
    return catalogPackageLocationId.toString() === scanLocationId;
  }
  return true;
}

export async function resolveLegacyOpenGymLocationId(): Promise<string | null> {
  const envDefault = process.env.LEGACY_OPEN_GYM_DEFAULT_LOCATION_ID;
  if (envDefault && Types.ObjectId.isValid(envDefault)) {
    const configured = await Location.findById(envDefault).select("_id");
    if (configured) {
      return envDefault;
    }
  }

  const locations = await Location.find({}).select("_id");
  if (locations.length === 1) {
    return (locations[0]._id as Types.ObjectId).toString();
  }

  return null;
}
