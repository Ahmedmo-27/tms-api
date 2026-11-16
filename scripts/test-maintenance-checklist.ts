import assert from "node:assert";
import { Types } from "mongoose";
import {
  getCairoSlotInfo,
  getCurrentHourSlot,
  updateChecklistItem,
  batchUpdateChecklist,
  getManagementOverview,
  getMaintenanceHistory,
} from "../src/controllers/admin/maintenance-controller";
import SpaceMaintenanceLog, {
  DEFAULT_MAINTENANCE_ITEMS,
} from "../src/models/spaceMaintenanceLog";
import Location from "../src/models/location";

function mockResponse() {
  const res: any = {};
  res.statusCode = 200;
  res.status = function (code: number) {
    this.statusCode = code;
    return this;
  };
  res.json = function (body: any) {
    this.body = body;
    return this;
  };
  return res;
}

async function runTests() {
  console.log("Starting Maintenance Checklist Unit Tests...");

  // 1. Test getCairoSlotInfo
  const slotInfo = getCairoSlotInfo(new Date());
  assert.match(slotInfo.slotDate, /^\d{4}-\d{2}-\d{2}$/, "slotDate should match YYYY-MM-DD");
  assert.ok(slotInfo.slotHour >= 0 && slotInfo.slotHour <= 23, "slotHour between 0 and 23");
  assert.ok(slotInfo.secondsRemainingInHour >= 0 && slotInfo.secondsRemainingInHour <= 3600, "seconds remaining in range");
  console.log("✓ getCairoSlotInfo tests passed");

  // Mock Location and SpaceMaintenanceLog
  const mockLocationId = new Types.ObjectId();
  const mockUserId = new Types.ObjectId();

  (Location as any).findById = (id: any) => ({
    lean: async () => ({
      _id: mockLocationId,
      branchName: "Main Branch",
      location: "New Cairo",
    }),
  });

  (Location as any).find = () => ({
    lean: async () => [
      { _id: mockLocationId, branchName: "Main Branch", location: "New Cairo" },
    ],
  });

  // 2. Test getCurrentHourSlot for branch_admin
  (SpaceMaintenanceLog as any).findOne = () => ({
    lean: async () => null, // No log yet -> default pending state
  });

  const req1: any = {
    user: {
      _id: mockUserId,
      name: "Ahmed BranchAdmin",
      role: "branch_admin",
      locationId: mockLocationId,
    },
    query: {},
  };
  const res1 = mockResponse();

  await getCurrentHourSlot(req1, res1, (err: any) => {
    if (err) throw err;
  });

  assert.strictEqual(res1.statusCode, 200);
  assert.strictEqual(res1.body.data.location.branchName, "Main Branch");
  assert.strictEqual(res1.body.data.items.length, 4);
  assert.strictEqual(res1.body.data.completedCount, 0);
  assert.strictEqual(res1.body.data.overallStatus, "pending");
  assert.deepStrictEqual(
    res1.body.data.items.map((i: any) => i.id),
    ["showers_bottles", "towels", "communal_area", "gym_prepared"]
  );
  console.log("✓ getCurrentHourSlot tests passed");

  // 3. Test updateChecklistItem
  let savedDoc: any = null;
  const mockDocInstance: any = {
    locationId: mockLocationId,
    slotDate: slotInfo.slotDate,
    slotHour: slotInfo.slotHour,
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
    save: async function () {
      savedDoc = this;
      return this;
    },
  };

  (SpaceMaintenanceLog as any).findOne = async () => mockDocInstance;

  const req2: any = {
    user: {
      _id: mockUserId,
      name: "Ahmed BranchAdmin",
      role: "branch_admin",
      locationId: mockLocationId,
    },
    body: {
      itemId: "towels",
      isCompleted: true,
      notes: "Towels refilled and folded",
    },
  };
  const res2 = mockResponse();

  await updateChecklistItem(req2, res2, (err: any) => {
    if (err) throw err;
  });

  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(savedDoc.items[1].isCompleted, true);
  assert.strictEqual(savedDoc.items[1].notes, "Towels refilled and folded");
  assert.strictEqual(savedDoc.overallStatus, "in_progress");
  console.log("✓ updateChecklistItem tests passed");

  // 4. Test batchUpdateChecklist to complete all items
  const req3: any = {
    user: {
      _id: mockUserId,
      name: "Management Lead",
      role: "management",
    },
    body: {
      locationId: mockLocationId.toString(),
      items: [
        { id: "showers_bottles", isCompleted: true },
        { id: "towels", isCompleted: true },
        { id: "communal_area", isCompleted: true },
        { id: "gym_prepared", isCompleted: true },
      ],
      notes: "Space inspection complete",
    },
  };
  const res3 = mockResponse();

  await batchUpdateChecklist(req3, res3, (err: any) => {
    if (err) throw err;
  });

  assert.strictEqual(res3.statusCode, 200);
  assert.strictEqual(savedDoc.overallStatus, "completed");
  assert.ok(savedDoc.completedAt !== null);
  console.log("✓ batchUpdateChecklist tests passed");

  // 5. Test getManagementOverview
  (SpaceMaintenanceLog as any).find = () => ({
    lean: async () => [savedDoc],
  });

  const req4: any = {
    user: {
      _id: mockUserId,
      role: "management",
    },
  };
  const res4 = mockResponse();

  await getManagementOverview(req4, res4, (err: any) => {
    if (err) throw err;
  });

  assert.strictEqual(res4.statusCode, 200);
  assert.strictEqual(res4.body.data.branches.length, 1);
  assert.strictEqual(res4.body.data.branches[0].branchName, "Main Branch");
  console.log("✓ getManagementOverview tests passed");

  console.log("\nALL MAINTENANCE BACKEND TESTS PASSED SUCCESSFULLY! 🎉\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
