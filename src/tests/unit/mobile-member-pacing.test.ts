import { Request, Response } from "express";
import { mobileMemberPackagePacing } from "../../middlewares/mobileMemberPacing";

describe("mobileMemberPackagePacing middleware", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("paces requests for mobile members with no query filter by 500ms", () => {
    const req: any = {
      deviceType: "mobile",
      user: { role: "member" },
      query: {},
      headers: {},
    };
    const res: any = {};
    const next = jest.fn();

    mobileMemberPackagePacing(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();

    jest.advanceTimersByTime(499);
    expect(next).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not pace requests for non-members (role: user)", () => {
    const req: any = {
      deviceType: "mobile",
      user: { role: "user" },
      query: {},
      headers: {},
    };
    const res: any = {};
    const next = jest.fn();

    mobileMemberPackagePacing(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not pace web requests", () => {
    const req: any = {
      deviceType: "web",
      user: { role: "member" },
      query: {},
      headers: {},
    };
    const res: any = {};
    const next = jest.fn();

    mobileMemberPackagePacing(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not pace filtered requests (e.g. category specified)", () => {
    const req: any = {
      deviceType: "mobile",
      user: { role: "member" },
      query: { category: "pt" },
      headers: {},
    };
    const res: any = {};
    const next = jest.fn();

    mobileMemberPackagePacing(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not pace search requests (e.g. name specified)", () => {
    const req: any = {
      deviceType: "mobile",
      user: { role: "member" },
      query: { name: "functional" },
      headers: {},
    };
    const res: any = {};
    const next = jest.fn();

    mobileMemberPackagePacing(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("detects mobile from x-device-type header even if deviceType is unset", () => {
    const req: any = {
      user: { role: "member" },
      query: {},
      headers: { "x-device-type": "mobile" },
    };
    const res: any = {};
    const next = jest.fn();

    mobileMemberPackagePacing(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
