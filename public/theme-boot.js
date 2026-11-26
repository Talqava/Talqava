// Sets the light or dark theme before the page draws, so it never flashes the wrong one.
// Dark is the default; "system" follows the computer's appearance, and keeps following it.
(() => {
  let choice = "dark";
  try {
    // The look chosen before dark became the standard one is set aside once, so everyone starts in the new look;
    // a choice made after that is kept as before.
    if (!localStorage.getItem("talqava.look")) {
      localStorage.removeItem("talqava.theme");
      localStorage.setItem("talqava.look", "2");
    }
    choice = localStorage.getItem("talqava.theme") || "dark";
  } catch {}
  const system = matchMedia("(prefers-color-scheme: light)");
  const apply = () => {
    const theme = choice === "system" ? (system.matches ? "light" : "dark") : choice;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#F3F5F3" : "#0A0A0A");
  };
  apply();
  system.addEventListener("change", () => choice === "system" && (apply(), window.dispatchEvent(new Event("talqava-theme"))));
  window.talqavaTheme = {
    get choice() {
      return choice;
    },
    set(next) {
      choice = ["light", "dark", "system"].includes(next) ? next : "dark";
      try {
        localStorage.setItem("talqava.theme", choice);
      } catch {}
      apply();
      window.dispatchEvent(new Event("talqava-theme"));
    },
  };
})();
