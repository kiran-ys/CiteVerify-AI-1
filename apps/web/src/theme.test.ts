import { describe, expect, test } from "bun:test";
import {
  readPreference,
  resolveTheme,
  savePreference,
  THEME_KEY,
} from "./theme.ts";

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

describe("theme preference", () => {
  test("defaults to system and follows the operating system", () => {
    expect(readPreference(memory())).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  test("an explicit choice is saved, restored, and wins over the system", () => {
    const store = memory();
    savePreference(store, "dark");
    expect(store.data.get(THEME_KEY)).toBe("dark");
    expect(readPreference(store)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  test("choosing system clears the saved value; bad or blocked storage is safe", () => {
    const store = memory();
    savePreference(store, "light");
    savePreference(store, "system");
    expect(store.data.has(THEME_KEY)).toBe(false);
    store.setItem(THEME_KEY, "purple");
    expect(readPreference(store)).toBe("system");
    const blocked = {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
      removeItem: () => {
        throw new Error("x");
      },
    };
    expect(readPreference(blocked)).toBe("system");
    expect(() => savePreference(blocked, "dark")).not.toThrow();
  });
});
