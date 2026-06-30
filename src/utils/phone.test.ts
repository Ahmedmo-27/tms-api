import { normalizePhoneNumber } from "./phone";

describe("normalizePhoneNumber", () => {
  it("removes spaces from phone numbers", () => {
    expect(normalizePhoneNumber("01 234 567 8901")).toBe("012345678901");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePhoneNumber("  012345678901  ")).toBe("012345678901");
  });
});
