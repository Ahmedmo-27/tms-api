import { Types } from "mongoose";
import User from "../../models/user";
import Member from "../../models/member";
import Package from "../../models/package";
import NonUserPackage from "../../models/nonUserPackage";
import Payment from "../../models/payment";
import { registerUser } from "../../controllers/auth/auth-controller";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { PaymentsService } from "../../services/payments-service";

jest.mock("../../models/user");
jest.mock("../../models/member");
jest.mock("../../models/package", () => {
  const actual = jest.requireActual("../../models/package");
  const mockModel: any = jest.fn();
  mockModel.findById = jest.fn();
  return {
    __esModule: true,
    default: mockModel,
    getPackageEndDate: actual.getPackageEndDate,
    isUnlimitedSpaceAccess: actual.isUnlimitedSpaceAccess,
  };
});
jest.mock("../../models/nonUserPackage");
jest.mock("../../models/payment");
jest.mock("../../services/payments-service");
jest.mock("../../services/egygap-erp-service", () => ({
  sendPaymentToRentalSystem: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models/dailyAttendance", () => ({
  __esModule: true,
  default: {
    updateMany: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

// Mock transaction runner to execute callback immediately
jest.mock("../../utils/transaction", () => ({
  runInTransaction: jest.fn(async (cb: (session: any) => Promise<any>) => {
    return await cb({} as any);
  }),
}));

describe("Non-Member Package to Mobile Registration Flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("addNonUserPackage auto-creates pending user with empty email", () => {
    it("creates a User record with empty email and role user when phone does not exist", async () => {
      const pkgId = new Types.ObjectId().toString();
      const mockPkg = {
        _id: new Types.ObjectId(pkgId),
        name: "10 Sessions",
        numberOfSessions: 10,
        price: 1500,
        expiryPeriod: 30,
        isDeprecated: false,
        category: "STUDIO",
      };
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);
      const queryChain: any = Promise.resolve(null);
      queryChain.session = jest.fn().mockReturnValue(queryChain);
      (NonUserPackage.findOne as jest.Mock).mockReturnValue(queryChain);
      (User.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      (PaymentsService.savePayment as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
        amount: 1500,
      });

      const mockUserSave = jest.fn().mockResolvedValue({});
      (User as unknown as jest.Mock).mockImplementation(function (this: any, data: any) {
        Object.assign(this, data);
        this.save = mockUserSave;
      });

      const mockNonUserPackageSave = jest.fn().mockResolvedValue({});
      (NonUserPackage as unknown as jest.Mock).mockImplementation(function (this: any, data: any) {
        Object.assign(this, data);
        this.save = mockNonUserPackageSave;
      });

      await SubscriptionsService.addNonUserPackage(
        "Admin Entered Name",
        "01011112222",
        pkgId,
        "2026-10-15",
        "CASH",
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        "29901011234567"
      );

      expect(User).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Admin Entered Name",
          phoneNumber: "01011112222",
          email: "",
          role: "user",
          nationalId: "29901011234567",
        })
      );
      expect(mockUserSave).toHaveBeenCalled();
      expect(mockNonUserPackageSave).toHaveBeenCalled();
      expect(NonUserPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Admin Entered Name",
          phoneNumber: "01011112222",
          nationalId: "29901011234567",
        })
      );
    });
  });

  describe("registerUser mobile account claiming", () => {
    it("claims pending account, overrides name, sets email, and activates member", async () => {
      const existingUserId = new Types.ObjectId();
      const mockGenerateToken = jest.fn().mockResolvedValue("mock-jwt-token");
      const mockSave = jest.fn().mockResolvedValue({});

      const existingUserDoc = {
        _id: existingUserId,
        name: "Admin Entered Name",
        phoneNumber: "01011112222",
        email: "",
        password: "",
        role: "user",
        save: mockSave,
        generateAuthToken: mockGenerateToken,
      };

      (User.findOne as jest.Mock).mockImplementation(({ phoneNumber, email }: any) => {
        if (phoneNumber) return Promise.resolve(existingUserDoc);
        if (email) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      (Member.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      (Member as unknown as jest.Mock).mockImplementation(function (this: any, data: any) {
        Object.assign(this, data);
        this.save = jest.fn().mockResolvedValue({});
      });

      const transferSpy = jest
        .spyOn(SubscriptionsService, "transferStagedPackagesToMember")
        .mockResolvedValue(undefined as any);

      const req: any = {
        body: {
          name: "User Overridden Name",
          email: "member@example.com",
          password: "SecurePassword123!",
          phoneNumber: "01011112222",
          fcmToken: "sample-fcm-token",
        },
      };

      let responsePayload: any;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((body) => {
          responsePayload = body;
        }),
      };

      const next = jest.fn();
      await registerUser(req, res, next);

      expect(existingUserDoc.name).toBe("User Overridden Name");
      expect(existingUserDoc.email).toBe("member@example.com");
      expect(existingUserDoc.role).toBe("member");
      expect(mockSave).toHaveBeenCalled();
      expect(transferSpy).toHaveBeenCalledWith(
        existingUserId.toString(),
        "01011112222",
        expect.anything()
      );
      expect(responsePayload.data.token).toBe("mock-jwt-token");
      expect(responsePayload.data.user.role).toBe("member");
    });

    it("rejects with PHONE_ALREADY_EXISTS if user already has an active account with email", async () => {
      const existingUserDoc = {
        _id: new Types.ObjectId(),
        name: "Already Registered",
        phoneNumber: "01011112222",
        email: "already@example.com",
        password: "hashed-password",
        role: "member",
      };

      (User.findOne as jest.Mock).mockResolvedValue(existingUserDoc);

      const req: any = {
        body: {
          name: "Another Person",
          email: "another@example.com",
          password: "SecurePassword123!",
          phoneNumber: "01011112222",
        },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await registerUser(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "PHONE_ALREADY_EXISTS",
        })
      );
    });

    it("rejects with EMAIL_ALREADY_EXISTS if email is taken by another account", async () => {
      const existingUserDoc = {
        _id: new Types.ObjectId(),
        name: "Admin Name",
        phoneNumber: "01011112222",
        email: "",
        password: "",
        role: "user",
      };

      const otherUserWithEmail = {
        _id: new Types.ObjectId(),
        email: "taken@example.com",
      };

      (User.findOne as jest.Mock).mockImplementation(({ phoneNumber, email }: any) => {
        if (phoneNumber) return Promise.resolve(existingUserDoc);
        if (email) return Promise.resolve(otherUserWithEmail);
        return Promise.resolve(null);
      });

      const req: any = {
        body: {
          name: "User Name",
          email: "taken@example.com",
          password: "SecurePassword123!",
          phoneNumber: "01011112222",
        },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await registerUser(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "EMAIL_ALREADY_EXISTS",
        })
      );
    });
  });
});
