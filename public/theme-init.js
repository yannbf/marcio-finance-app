/* eslint-disable */
/**
 * Pre-paint theme bootstrap. Runs synchronously from <head>, sets the
 * .dark class + color-scheme based on localStorage so we don't get a
 * white flash before React hydrates.
 *
 * Lives outside React so we don't trip the "<script> in JSX" hydration
 * warning. ThemeApplier (client component) keeps the class in sync
 * across locale switches and theme toggles after hydration.
 */
(function () {
  try {
    var t = localStorage.getItem("marcio-theme") || "dark";
    var dark =
      t === "dark" ||
      (t === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();
