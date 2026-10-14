const PASSWORD_SHA256 =
  "2bc79e39b9170f683d37c580c845e9f82824c7ed152a2b88a11c7abe91b94fcf";
const SESSION_KEY = "pin-peel-auth";

const gate = document.querySelector("#gate");
const form = document.querySelector("#gate-form");
const input = document.querySelector("#gate-password");
const error = document.querySelector("#gate-error");

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function unlock() {
  sessionStorage.setItem(SESSION_KEY, PASSWORD_SHA256);
  document.body.classList.add("is-open");
  gate?.remove();
  await import("./app.js");
}

async function isAuthorized() {
  return sessionStorage.getItem(SESSION_KEY) === PASSWORD_SHA256;
}

if (await isAuthorized()) {
  await unlock();
} else {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const hash = await sha256Hex(input.value);
    if (hash !== PASSWORD_SHA256) {
      error.hidden = false;
      input.value = "";
      input.focus();
      return;
    }
    await unlock();
  });
  input.focus();
}
