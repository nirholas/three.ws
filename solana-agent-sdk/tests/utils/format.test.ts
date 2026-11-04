import { describe, it, expect } from "@jest/globals";
import { toUiAmount } from "../../src/utils/format.js";

describe("toUiAmount", () => {
  it.each([
    ["0", 6, "0"],
    ["1", 6, "0.000001"],
    ["1000000", 6, "1"],
    ["1500000", 6, "1.5"],
    ["123456789", 9, "0.123456789"],
    ["42", 0, "42"],
    ["100", 2, "1"],
    ["101", 2, "1.01"],
  ])("formats %s with %i decimals as %s", (raw, decimals, expected) => {
    expect(toUiAmount(raw, decimals)).toBe(expected);
  });

  it("is exact for amounts beyond Number.MAX_SAFE_INTEGER", () => {
    expect(toUiAmount("18446744073709551615", 9)).toBe("18446744073.709551615");
    expect(toUiAmount("9007199254740993", 0)).toBe("9007199254740993");
  });

  it("handles decimals above 15, where 10 ** decimals loses precision as a Number", () => {
    expect(toUiAmount("1", 18)).toBe("0.000000000000000001");
    expect(toUiAmount("1000000000000000000", 18)).toBe("1");
  });
});
