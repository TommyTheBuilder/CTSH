(function () {
  const THEME_KEY = "themePreference";

  function normalizeTheme(theme) {
    return String(theme || "").trim().toLowerCase() === "dark" ? "dark" : "light";
  }

  function getStoredTheme() {
    const storedTheme = localStorage.getItem(THEME_KEY);
    return storedTheme ? normalizeTheme(storedTheme) : null;
  }

  function getAuthHeaders(options = {}) {
    const tokenKeys = Array.isArray(options.tokenStorageKeys) && options.tokenStorageKeys.length
      ? options.tokenStorageKeys
      : ["token"];

    for (const key of tokenKeys) {
      const token = String(localStorage.getItem(key) || "").trim();
      if (token) return { Authorization: `Bearer ${token}` };
    }

    return {};
  }

  function applyTheme(theme, options = {}) {
    const normalizedTheme = normalizeTheme(theme);
    const isDark = normalizedTheme === "dark";
    const bodyClass = options.bodyClass;
    const htmlClass = options.htmlClass;

    if (bodyClass && document.body) {
      document.body.classList.toggle(bodyClass, isDark);
    }

    if (htmlClass) {
      document.documentElement.classList.toggle(htmlClass, isDark);
    }

    if (typeof options.onApply === "function") {
      options.onApply(normalizedTheme);
    }

    return normalizedTheme;
  }

  async function persistTheme(theme, options = {}) {
    const normalizedTheme = normalizeTheme(theme);
    localStorage.setItem(THEME_KEY, normalizedTheme);

    try {
      await fetch("/api/theme", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(options)
        },
        body: JSON.stringify({ theme: normalizedTheme })
      });
    } catch {
      // Local fallback is sufficient when the API is temporarily unavailable.
    }

    return normalizedTheme;
  }

  async function resolveInitialTheme(options = {}) {
    const storedTheme = getStoredTheme();
    const fallbackTheme = storedTheme || "light";
    applyTheme(fallbackTheme, options);

    try {
      const response = await fetch("/api/theme", {
        credentials: "include",
        headers: getAuthHeaders(options)
      });
      if (!response.ok) return fallbackTheme;

      const data = await response.json().catch(() => ({}));
      const resolvedTheme = normalizeTheme(data?.theme);
      localStorage.setItem(THEME_KEY, resolvedTheme);
      applyTheme(resolvedTheme, options);
      return resolvedTheme;
    } catch {
      return fallbackTheme;
    }
  }

  window.CtshTheme = {
    THEME_KEY,
    applyTheme,
    getStoredTheme,
    persistTheme,
    resolveInitialTheme
  };
})();
