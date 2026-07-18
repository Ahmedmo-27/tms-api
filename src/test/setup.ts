process.env.NODE_ENV = "testing";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-for-scan-flows";

jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));
