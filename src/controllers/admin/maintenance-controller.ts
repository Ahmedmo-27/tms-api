import { Request, Response } from "express";
import { Types } from "mongoose";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import SpaceMaintenanceLog, {
  DEFAULT_MAINTENANCE_ITEMS,
  IMaintenanceCheckItem,
  MaintenanceOverallStatus,
} from "../../models/spaceMaintenanceLog";
import Location from "../../models/location";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import {
  getAssignedBranchLocationId,
  isBranchScopedRole,
  isManagementRole,
  resolveLocationFilter,
  resolveLocationIdForWrite,
} from "../../utils/location-scope";
import { CAIRO_TZ, cairoDateKey } from "../../utils/timezone";

/** Helper to compute Cairo slot information for a given date/time */
export function getCairoSlotInfo(date: Date = new Date()) {
  const slotDate = cairoDateKey(date);
  const hourStr = formatInTimeZone(date, CAIRO_TZ, "H");
  const slotHour = parseInt(hourStr, 10);

  const cairoTime = toZonedTime(date, CAIRO_TZ);
  cairoTime.setMinutes(0, 0, 0);
  const slotStartTime = fromZonedTime(cairoTime, CAIRO_TZ);

  cairoTime.setHours(cairoTime.getHours() + 1, 0, 0, 0);
  const nextHourStartTime = fromZonedTime(cairoTime, CAIRO_TZ);
  const secondsRemainingInHour = Math.max(
    0,
    Math.floor((nextHourStartTime.getTime() - date.getTime()) / 1000)
  );

  return {
    slotDate,
    slotHour,
    slotStartTime,
    nextHourStartTime,
    secondsRemainingInHour,
  };
}

/** Compute overallStatus from items */
function calculateOverallStatus(
  items: IMaintenanceCheckItem[]
): MaintenanceOverallStatus {
  const completedCount = items.filter((i) => i.isCompleted).length;
  if (completedCount === 0) return "pending";
  if (completedCount === items.length) return "completed";
  return "in_progress";
}

/**
 * GET /admin/maintenance/current
 * Retrieves the checklist for the current hour slot for a branch.
 */
export const getCurrentHourSlot = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    let locationId: string | null = null;
    const assignedLocationId = getAssignedBranchLocationId(req);

    if (assignedLocationId) {
      locationId = assignedLocationId;
    } else {
      const queryLocation = req.query.locationId as string;
      if (queryLocation && Types.ObjectId.isValid(queryLocation)) {
        locationId = queryLocation;
      } else {
        const firstLocation = await Location.findOne().lean();
        if (firstLocation) {
          locationId = (firstLocation as any)._id.toString();
        }
      }
    }

    if (!locationId) {
      throw new BadRequestError(
        "BRANCH_REQUIRED",
        "A valid branch locationId is required"
      );
    }

    const branch = await Location.findById(locationId).lean();
    if (!branch) {
      throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found", {
        locationId,
      });
    }

    const slotInfo = getCairoSlotInfo(new Date());

    let log = await SpaceMaintenanceLog.findOne({
      locationId: new Types.ObjectId(locationId),
      slotDate: slotInfo.slotDate,
      slotHour: slotInfo.slotHour,
    }).lean();

    // If not created yet in DB, return clean default state
    const items =
      log?.items ||
      DEFAULT_MAINTENANCE_ITEMS.map((item) => ({
        id: item.id,
        title: item.title,
        isCompleted: false,
        completedAt: null,
        completedBy: null,
        completedByName: "",
        notes: "",
      }));

    const overallStatus: MaintenanceOverallStatus =
      log?.overallStatus || "pending";
    const completedCount = items.filter((i) => i.isCompleted).length;

    new SuccessResponse("Current Maintenance Slot Fetched", {
      location: {
        _id: branch._id,
        branchName: branch.branchName,
        location: branch.location,
      },
      slotDate: slotInfo.slotDate,
      slotHour: slotInfo.slotHour,
      slotStartTime: slotInfo.slotStartTime,
      nextHourStartTime: slotInfo.nextHourStartTime,
      secondsRemainingInHour: slotInfo.secondsRemainingInHour,
      items,
      overallStatus,
      completedCount,
      totalCount: items.length,
      lastUpdatedBy: log?.lastUpdatedBy || null,
      lastUpdatedByName: log?.lastUpdatedByName || "",
      notes: log?.notes || "",
      isCurrentHourActive: true,
    }).send(res);
  }
);

/**
 * POST /admin/maintenance/check
 * Updates an individual checklist item for the current (or specified) hour slot.
 */
export const updateChecklistItem = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const locationId = resolveLocationIdForWrite(req);
    const { itemId, isCompleted, notes, slotHour: targetHour, slotDate: targetDate } = req.body;

    const validItemIds = ["showers_bottles", "towels", "communal_area", "gym_prepared"];
    if (!itemId || !validItemIds.includes(itemId)) {
      throw new BadRequestError(
        "INVALID_ITEM_ID",
        `itemId must be one of: ${validItemIds.join(", ")}`
      );
    }

    if (typeof isCompleted !== "boolean") {
      throw new BadRequestError("INVALID_STATUS", "isCompleted must be a boolean");
    }

    const now = new Date();
    const currentSlot = getCairoSlotInfo(now);
    const slotDate = targetDate || currentSlot.slotDate;
    const slotHour = targetHour !== undefined ? Number(targetHour) : currentSlot.slotHour;

    if (slotHour < 0 || slotHour > 23) {
      throw new BadRequestError("INVALID_HOUR", "slotHour must be between 0 and 23");
    }

    const user = (req as any).user;
    const userId = user?._id ? new Types.ObjectId(user._id) : null;
    const userName = user?.name || "Staff";

    // Find or initialize log doc
    let log = await SpaceMaintenanceLog.findOne({
      locationId: new Types.ObjectId(locationId),
      slotDate,
      slotHour,
    });

    if (!log) {
      log = new SpaceMaintenanceLog({
        locationId: new Types.ObjectId(locationId),
        slotDate,
        slotHour,
        slotStartTime: currentSlot.slotStartTime,
        items: DEFAULT_MAINTENANCE_ITEMS.map((item) => ({
          id: item.id,
          title: item.title,
          isCompleted: false,
          completedAt: null,
          completedBy: null,
          completedByName: "",
          notes: "",
        })),
        overallStatus: "pending",
      });
    }

    // Update specific item
    const targetItem = log.items.find((i) => i.id === itemId);
    if (targetItem) {
      targetItem.isCompleted = isCompleted;
      targetItem.completedAt = isCompleted ? now : null;
      targetItem.completedBy = isCompleted ? userId : null;
      targetItem.completedByName = isCompleted ? userName : "";
      if (notes !== undefined) {
        targetItem.notes = notes;
      }
    }

    log.overallStatus = calculateOverallStatus(log.items);
    if (log.overallStatus === "completed" && !log.completedAt) {
      log.completedAt = now;
    } else if (log.overallStatus !== "completed") {
      log.completedAt = null;
    }

    log.lastUpdatedBy = userId;
    log.lastUpdatedByName = userName;
    await log.save();

    const completedCount = log.items.filter((i) => i.isCompleted).length;

    new SuccessResponse("Checklist Item Updated", {
      log,
      completedCount,
      totalCount: log.items.length,
      overallStatus: log.overallStatus,
    }).send(res);
  }
);

/**
 * POST /admin/maintenance/batch-submit
 * Batch marks items or submits all 4 checklist items at once.
 */
export const batchUpdateChecklist = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const locationId = resolveLocationIdForWrite(req);
    const { items, notes, slotHour: targetHour, slotDate: targetDate } = req.body;

    if (!Array.isArray(items)) {
      throw new BadRequestError("INVALID_ITEMS", "items array is required");
    }

    const now = new Date();
    const currentSlot = getCairoSlotInfo(now);
    const slotDate = targetDate || currentSlot.slotDate;
    const slotHour = targetHour !== undefined ? Number(targetHour) : currentSlot.slotHour;

    const user = (req as any).user;
    const userId = user?._id ? new Types.ObjectId(user._id) : null;
    const userName = user?.name || "Staff";

    let log = await SpaceMaintenanceLog.findOne({
      locationId: new Types.ObjectId(locationId),
      slotDate,
      slotHour,
    });

    if (!log) {
      log = new SpaceMaintenanceLog({
        locationId: new Types.ObjectId(locationId),
        slotDate,
        slotHour,
        slotStartTime: currentSlot.slotStartTime,
        items: DEFAULT_MAINTENANCE_ITEMS.map((item) => ({
          id: item.id,
          title: item.title,
          isCompleted: false,
          completedAt: null,
          completedBy: null,
          completedByName: "",
          notes: "",
        })),
        overallStatus: "pending",
      });
    }

    for (const update of items) {
      const targetItem = log.items.find((i) => i.id === update.id);
      if (targetItem && typeof update.isCompleted === "boolean") {
        targetItem.isCompleted = update.isCompleted;
        targetItem.completedAt = update.isCompleted ? (targetItem.completedAt || now) : null;
        targetItem.completedBy = update.isCompleted ? (targetItem.completedBy || userId) : null;
        targetItem.completedByName = update.isCompleted ? (targetItem.completedByName || userName) : "";
        if (update.notes !== undefined) {
          targetItem.notes = update.notes;
        }
      }
    }

    if (notes !== undefined) {
      log.notes = notes;
    }

    log.overallStatus = calculateOverallStatus(log.items);
    if (log.overallStatus === "completed" && !log.completedAt) {
      log.completedAt = now;
    } else if (log.overallStatus !== "completed") {
      log.completedAt = null;
    }

    log.lastUpdatedBy = userId;
    log.lastUpdatedByName = userName;
    await log.save();

    new SuccessResponse("Maintenance Checklist Saved", {
      log,
      completedCount: log.items.filter((i) => i.isCompleted).length,
      totalCount: log.items.length,
      overallStatus: log.overallStatus,
    }).send(res);
  }
);

/**
 * GET /admin/maintenance/overview
 * Real-time overview across all branches for the current hour slot (Management only).
 */
export const getManagementOverview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userRole = (req as any).user?.role;
    if (!isManagementRole(userRole)) {
      throw new BadRequestError("FORBIDDEN", "Management role required for overview");
    }

    const locations = await Location.find().lean();
    const slotInfo = getCairoSlotInfo(new Date());

    // Standard gym operating hours for compliance rate: 07:00 to 23:00 (17 hours)
    const operatingStartHour = 7;
    const operatingEndHour = 23;
    const elapsedOperatingHours = Math.max(
      1,
      Math.min(slotInfo.slotHour - operatingStartHour + 1, operatingEndHour - operatingStartHour + 1)
    );

    // Fetch logs for today across all locations
    const todayLogs = await SpaceMaintenanceLog.find({
      slotDate: slotInfo.slotDate,
    }).lean();

    const branchCards = locations.map((loc) => {
      const locIdStr = loc._id.toString();
      const currentLog = todayLogs.find(
        (l) => l.locationId.toString() === locIdStr && l.slotHour === slotInfo.slotHour
      );

      const items =
        currentLog?.items ||
        DEFAULT_MAINTENANCE_ITEMS.map((item) => ({
          id: item.id,
          title: item.title,
          isCompleted: false,
          completedAt: null,
          completedBy: null,
          completedByName: "",
          notes: "",
        }));

      const completedCount = items.filter((i) => i.isCompleted).length;
      const overallStatus = currentLog?.overallStatus || "pending";

      // Today's completed hours for this branch
      const completedTodayHours = todayLogs.filter(
        (l) =>
          l.locationId.toString() === locIdStr &&
          l.slotHour >= operatingStartHour &&
          l.slotHour <= slotInfo.slotHour &&
          l.overallStatus === "completed"
      ).length;

      const complianceRate = Math.round(
        (completedTodayHours / elapsedOperatingHours) * 100
      );

      return {
        locationId: loc._id,
        branchName: loc.branchName,
        location: loc.location,
        currentHour: {
          slotHour: slotInfo.slotHour,
          overallStatus,
          completedCount,
          totalCount: items.length,
          items,
          lastUpdatedByName: currentLog?.lastUpdatedByName || "",
          lastUpdatedAt: currentLog?.updatedAt || null,
        },
        todayStats: {
          completedHours: completedTodayHours,
          elapsedOperatingHours,
          complianceRate,
        },
      };
    });

    // Overall organization compliance today
    const totalPossibleSlots = branchCards.length * elapsedOperatingHours;
    const totalCompletedSlots = branchCards.reduce(
      (sum, b) => sum + b.todayStats.completedHours,
      0
    );
    const overallCompliance =
      totalPossibleSlots > 0
        ? Math.round((totalCompletedSlots / totalPossibleSlots) * 100)
        : 100;

    new SuccessResponse("Maintenance Overview Fetched", {
      slotDate: slotInfo.slotDate,
      slotHour: slotInfo.slotHour,
      secondsRemainingInHour: slotInfo.secondsRemainingInHour,
      overallCompliance,
      branches: branchCards,
    }).send(res);
  }
);

/**
 * GET /admin/maintenance/history
 * Hourly audit history for a date/range and branch.
 */
export const getMaintenanceHistory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;
    const targetLocationId = resolveLocationFilter(req);
    const dateQuery = (req.query.date as string) || cairoDateKey(new Date());

    const query: Record<string, any> = {
      slotDate: dateQuery,
    };

    if (targetLocationId) {
      query.locationId = new Types.ObjectId(targetLocationId);
    }

    const logs = await SpaceMaintenanceLog.find(query)
      .populate("locationId", "branchName location")
      .sort({ slotHour: 1 })
      .lean();

    // Standard hours 07:00 to 23:00 timeline representation
    const timelineHours: number[] = [];
    for (let h = 7; h <= 23; h++) {
      timelineHours.push(h);
    }

    const currentSlot = getCairoSlotInfo(new Date());
    const isToday = dateQuery === currentSlot.slotDate;

    new SuccessResponse("Maintenance History Fetched", {
      date: dateQuery,
      currentCairoHour: currentSlot.slotHour,
      isToday,
      logs,
      timelineHours,
    }).send(res);
  }
);
