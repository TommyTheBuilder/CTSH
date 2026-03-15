const err = document.getElementById("err");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginForm = document.getElementById("loginForm");
const togglePasswordBtn = document.getElementById("togglePassword");
const loginBtnLabel = loginBtn ? loginBtn.textContent : "Login";

function setMessage(message, type = "error") {
  err.textContent = message || "";
  err.classList.toggle("is-success", type === "success" && Boolean(message));
}

async function submitLogin(event) {
  if (event) event.preventDefault();
  setMessage("");

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    setMessage("Bitte Benutzername und Passwort eingeben.");
    if (!username) usernameInput.focus();
    else passwordInput.focus();
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Anmeldung l\u00e4uft...";

  try {
    const response = await fetch("/api/login", {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Login fehlgeschlagen");

    localStorage.setItem("token", data.token);
    setMessage("Login erfolgreich. Weiterleitung wird vorbereitet.", "success");
      window.location.href = "/dashboard.html";
  } catch (error) {
    setMessage(error.message || "Login fehlgeschlagen");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = loginBtnLabel;
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", submitLogin);
} else if (loginBtn) {
  loginBtn.addEventListener("click", submitLogin);
}

if (togglePasswordBtn) {
  togglePasswordBtn.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    togglePasswordBtn.setAttribute("aria-pressed", String(isHidden));
    togglePasswordBtn.setAttribute("aria-label", isHidden ? "Passwort verbergen" : "Passwort anzeigen");
    togglePasswordBtn.textContent = isHidden ? "Verb." : "Anz.";
    togglePasswordBtn.classList.toggle("is-visible", isHidden);
    passwordInput.focus();
  });
}
