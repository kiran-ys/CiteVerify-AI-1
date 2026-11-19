/**
 * Light / dark / system theme. An explicit choice is saved in localStorage
 * and applied as data-theme on <html>; "system" removes it so CSS follows
 * prefers-color-scheme. index.html applies a saved choice before first paint.
 */
import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export const THEME_KEY = "citeverify.theme";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readPreference(
  storage: StorageLike | undefined,
): ThemePreference {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function savePreference(
  storage: StorageLike | undefined,
  preference: ThemePreference,
): void {
  try {
    if (preference === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, preference);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** The theme actually shown for a preference. */
export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

const store = () => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readPreference(store()),
  );
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") delete root.dataset.theme;
    else root.dataset.theme = preference;
    savePreference(store(), preference);
    // Enable colour transitions only after the first paint.
    requestAnimationFrame(() => root.classList.add("theme-ready"));
  }, [preference]);
  return {
    preference,
    resolved: resolveTheme(preference, systemDark),
    setPreference,
  };
}
