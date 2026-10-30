// Web portal window (opened from Northdesk's account menu): fills the portal's
// own sign-in form with the app's login and submits it, once per page load.
// The login comes from the main process, which gives it only to this window's
// top frame on the portal's host. Nothing is filled in sign-up mode, and a
// failed sign-in is left on screen (no retry loop).
// With no login saved yet (an app session restored without typing the
// password), a sign-in typed here that works is handed to the main process,
// which keeps it only when it is the app's own account.
const { ipcRenderer } = require('electron');

let tried = false;
let filledWith = null;
let observer = null;

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fillSignIn() {
  if (tried) return;
  const email = document.getElementById('login-email');
  const password = document.getElementById('login-password');
  if (!email || !password) return;
  // Sign-up mode (it has a confirm box): left to the user
  if (document.getElementById('login-confirm')) return;
  tried = true;
  if (observer) observer.disconnect();
  const login = await ipcRenderer.invoke('portal:getLogin').catch(() => null);
  if (!login) return; // nothing saved: the user signs in by hand
  setValue(email, login.email);
  setValue(password, login.password);
  filledWith = { email: login.email, password: login.password };
  setTimeout(() => {
    const button = document.querySelector('button.login-submit') || email.form?.querySelector('button[type="submit"]');
    if (button && !button.disabled) button.click();
  }, 60);
}

// A sign-in submitted on the portal's form: once the form is gone (signed in),
// hand it to main unless it is exactly what was filled in
let watching = null;
function watchSignIn() {
  const email = document.getElementById('login-email');
  const password = document.getElementById('login-password');
  if (!email || !password || document.getElementById('login-confirm')) return;
  const typed = { email: (email.value || '').trim(), password: password.value || '' };
  if (!typed.email || !typed.password) return;
  if (filledWith && typed.email.toLowerCase() === String(filledWith.email).toLowerCase() && typed.password === filledWith.password) return;
  if (watching) clearInterval(watching);
  const started = Date.now();
  watching = setInterval(() => {
    if (!document.getElementById('login-email')) {
      clearInterval(watching);
      watching = null;
      ipcRenderer.invoke('portal:learnLogin', typed).catch(() => {});
    } else if (Date.now() - started > 30000) {
      clearInterval(watching); // still on the sign-in form: it didn't work
      watching = null;
    }
  }, 300);
}
document.addEventListener('submit', (e) => {
  if (e.target?.querySelector?.('#login-email')) watchSignIn();
}, true);

window.addEventListener('DOMContentLoaded', () => {
  fillSignIn();
  // The portal is a React page: its form appears after the first render
  observer = new MutationObserver(() => { fillSignIn(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
