import { Types } from "mongoose";
import {
  FinanceService,
  isPtDropInPayment,
  extractCoachNameFromNote,
  findCoachIdByName,
  resolveCoachFromPtDropIn,
} from "./finance-service";
import Payment from "../models/payment";
import Coach from "../models/coach";
import Package from "../models/package";
import Class from "../models/class";
import Location from "../models/location";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import DeductionLog from "../models/deductionLog";
import DailyAttendance from "../models/dailyAttendance";
import NonUserBooking from "../models/nonUserBookings";
import { buildFinanceRange } from "../utils/finance-range";

jest.mock("../models/payment");
jest.mock("../models/coach");
jest.mock("../models/package");
jest.mock("../models/class");
jest.mock("../models/location");
jest.mock("../models/member");
jest.mock("../models/scheduledClass");
jest.mock("../models/deductionLog");
jest.mock("../models/dailyAttendance");
jest.mock("../models/nonUserBookings");

describe("Finance PT Drop-in Revenue Calculations", () => {
  const coach1Id = new Types.ObjectId().toString();
  const coach2Id = new Types.ObjectId().toString();

  const lookups = {
    packages: new Map(),
    packagesByName: new Map(),
    classes: new Map(),
    locations: new Map([["loc1", "Zamalek"]]),
    coaches: new Map([
      [coach1Id, "Salma Ghazzawi"],
      [coach2Id, "Omar El Alamy"],
    ]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Helper functions", () => {
    it("identifies PT drop-in payments correctly", () => {
      expect(
        isPtDropInPayment({
          purpose: "DROPIN",
          note: "PT dropin with Salma Ghazzawi",
        }),
      ).toBe(true);

      expect(
        isPtDropInPayment({
          purpose: "DROPIN",
          note: "Personal training guest drop-in with Captain Ziad",
        }),
      ).toBe(true);

      expect(
        isPtDropInPayment({
          purpose: "DROPIN",
          note: "PT dropin",
        }),
      ).toBe(true);

      expect(
        isPtDropInPayment({
          purpose: "DROPIN",
          note: "Reformer drop-in",
        }),
      ).toBe(false);

      expect(
        isPtDropInPayment({
          purpose: "PACKAGE",
          note: "Monthly Studio",
        }),
      ).toBe(false);
    });

    it("extracts coach name from note", () => {
      expect(
        extractCoachNameFromNote("PT dropin with Salma Ghazzawi; special discount"),
      ).toBe("Salma Ghazzawi");

      expect(
        extractCoachNameFromNote("Personal training drop-in with Omar El Alamy"),
      ).toBe("Omar El Alamy");

      expect(extractCoachNameFromNote("PT dropin")).toBeNull();
    });

    it("resolves coach ID by name including aliases and titles", () => {
      expect(findCoachIdByName("Salma Ghazzawi", lookups)).toBe(coach1Id);
      expect(findCoachIdByName("Salma", lookups)).toBe(coach1Id);
      expect(findCoachIdByName("Coach Salma", lookups)).toBe(coach1Id);
      expect(findCoachIdByName("Omar Alamy", lookups)).toBe(coach2Id);
      expect(findCoachIdByName("Unknown Person", lookups)).toBeNull();
    });

    it("resolves coach from payment direct coachId or note or attendance", () => {
      expect(
        resolveCoachFromPtDropIn({ coachId: coach1Id }, lookups),
      ).toBe(coach1Id);

      expect(
        resolveCoachFromPtDropIn(
          { purpose: "DROPIN", note: "PT dropin with Salma Ghazzawi" },
          lookups,
        ),
      ).toBe(coach1Id);

      const attendanceMap = new Map([["user123|2026-10-15", coach2Id]]);
      expect(
        resolveCoachFromPtDropIn(
          {
            uid: "user123",
            paymentTime: new Date("2026-10-15T10:00:00Z"),
            purpose: "DROPIN",
            note: "PT dropin",
          },
          lookups,
          attendanceMap,
        ),
      ).toBe(coach2Id);
    });
  });

  describe("coachHours calculation with PT drop-ins", () => {
    it("credits PT drop-in revenue and sessions to the coach in coachHours", async () => {
      const range = buildFinanceRange(
        { startDate: "2026-10-01", endDate: "2026-10-31" },
        null,
      );

      (Package.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (Class.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (Location.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { _id: new Types.ObjectId(coach1Id), coachName: "Salma Ghazzawi" },
          ]),
        }),
      });

      (ScheduledClass.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      });

      (Member.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (DeductionLog.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DailyAttendance.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      // PT drop-in payment of 750 EGP for Salma
      const ptDropInPayment = {
        _id: new Types.ObjectId(),
        uid: new Types.ObjectId(),
        amount: 750,
        paymentMethod: "CASH",
        paymentTime: new Date("2026-10-10T12:00:00Z"),
        purpose: "DROPIN",
        note: "PT dropin with Salma Ghazzawi",
        coachId: new Types.ObjectId(coach1Id),
        isRefunded: false,
      };

      (Payment.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([ptDropInPayment]),
          }),
          lean: jest.fn().mockResolvedValue([ptDropInPayment]),
        }),
      });

      const res = await FinanceService.coachHours(range);

      const salmaRow = res.coaches.find((c) => c.coachId === coach1Id);
      expect(salmaRow).toBeDefined();
      expect(salmaRow!.ptSessions).toBe(1);
      expect(salmaRow!.dropIns).toBe(1);
      expect(salmaRow!.dropInRevenue).toBe(750);
      expect(salmaRow!.attributedRevenue).toBe(750);
      expect(res.totals.ptSessions).toBe(1);
    });
  });

  describe("ptAnalytics calculation with PT drop-ins", () => {
    it("calculates PT drop-in revenue into coach revenue and totals in ptAnalytics", async () => {
      const range = buildFinanceRange(
        { startDate: "2026-10-01", endDate: "2026-10-31" },
        null,
      );

      (Package.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (Class.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (Location.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { _id: new Types.ObjectId(coach1Id), coachName: "Salma Ghazzawi" },
          ]),
        }),
      });

      (Member.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      (DeductionLog.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DailyAttendance.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      const ptDropInPayment = {
        _id: new Types.ObjectId(),
        uid: new Types.ObjectId(),
        amount: 800,
        paymentMethod: "VISA",
        paymentTime: new Date("2026-10-12T14:00:00Z"),
        purpose: "DROPIN",
        note: "PT dropin with Salma Ghazzawi",
        coachId: new Types.ObjectId(coach1Id),
        isRefunded: false,
      };

      (Payment.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([ptDropInPayment]),
          }),
          lean: jest.fn().mockResolvedValue([ptDropInPayment]),
        }),
      });
      (Payment.aggregate as jest.Mock).mockResolvedValue([]);

      const res = await FinanceService.ptAnalytics(range);

      const salma = res.coaches.find((c) => c.coachId === coach1Id);
      expect(salma).toBeDefined();
      expect(salma!.revenue).toBe(800);
      expect(salma!.sessions).toBe(1);
      expect(salma!.sales).toBe(1);
      expect(res.totals.revenue).toBe(800);
      expect(res.totals.sessions).toBe(1);
      expect(res.totals.sales).toBe(1);
    });
  });
});
