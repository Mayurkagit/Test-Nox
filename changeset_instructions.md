# Changeset: dda-desktop-electron — Changes to Apply on Main PC

> [!IMPORTANT]
> These are the **3 files** that differ between your local copy on this Mac and the current `main` branch of `https://github.com/rs1705/dda-desktop-electron`. Apply these changes on your main PC and push from there.

---

## Summary of Changes

| # | File | What Changed |
|---|------|-------------|
| 1 | `preload-dda.js` | **Parallel Race Engine** — Path A (background resolver) vs Path B (Tier 2 + Tier 3 cascade) for locality navigation. First to resolve a valid URL wins; loser is cancelled via `AbortController`. |
| 2 | `src/store/useAuthStore.js` | **Remember-Me persistence on logout** — Preserves `dda_remember_me` and `dda_remembered_credentials` in localStorage across app logout, alongside the existing login vault. |
| 3 | `src/views/WelcomeLogin.jsx` | **Remember-Me save-before-login** — Saves credentials *before* the login API call (since the component unmounts on success), removes them on failure, and changes label from "Remember me & save password" → "Remember me". |

> `package-lock.json` also differs but that's auto-generated — just run `npm install` after applying changes.

---

## File 1: `preload-dda.js`

### Change 1A — Add Parallel Race Engine variables (after line `return null;` / `}` block around line 4340)

Find this existing code:
```js
        return null;
      }

      // ─── TIER 2: Fast In-Page AJAX Waterfall Solver with Tree Reuse (Roadmap 5C.6) ───
```

Replace with:
```js
        return null;
      }

      // ─── PARALLEL RACE ENGINE: Path A (Background Resolver) vs Path B (Tier 2 + Tier 3 Cascade) ───
      // After Tier 1 cache miss, both paths run concurrently. First to resolve a valid URL navigates.
      // The loser's in-flight fetch calls are cancelled via AbortController.
      let raceWon = false;
      const cascadeAbort = new AbortController();
      const raceStartTime = Date.now();

      // Path A: Fire-and-forget background resolver running in parallel with cascade
      const pathA = (async () => {
        try {
          if (!currentSchemeId || !CONFIG.SECTOR || !CONFIG.POCKET || !CONFIG.BLOCK) return;
          const result = await resolveStep2DirectUrl(currentSchemeId, CONFIG);
          if (result && !raceWon && (!currentSchemeId || result.includes("/step2_form/" + currentSchemeId))) {
            raceWon = true;
            cascadeAbort.abort();
            const elapsed = Date.now() - raceStartTime;
            logAnalyticsStep("step3_locality", "Locality Skipped via Parallel Race Path A");
            appendRunLog(`🏆 [Locality Race] Path A WON in ${elapsed}ms — Direct URL: ${result}`, "ROUTE");
            console.log(
              `%c🏆 [Locality Race] Path A WON in ${elapsed}ms — Background resolver beat cascade!`,
              "background:#059669; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
            );
            ipcRenderer.send("dda:log", {
              level: "SUCCESS",
              pan: currentApplicant?.pan,
              page: "Locality Race",
              msg: `🏆 Path A WON in ${elapsed}ms — Direct URL jump: ${result}`,
            });
            window.location.replace(result);
          }
        } catch (_) {
          // Path A failed silently, Path B continues uninterrupted
        }
      })();

      if (currentSchemeId && CONFIG.SECTOR && CONFIG.POCKET && CONFIG.BLOCK) {
        appendRunLog(`🏁 [Locality Race] Starting parallel race: Path A (resolver) vs Path B (cascade)`, "INFO");
      }

      // Path B: Cascade (Tier 2 AJAX waterfall → Tier 3 DOM cascade) with race gate
      // ─── TIER 2: Fast In-Page AJAX Waterfall Solver with Tree Reuse (Roadmap 5C.6) ───
```

---

### Change 1B — Add `signal: cascadeAbort.signal` to the Tier 2 fetch call

Find this existing code inside the Tier 2 AJAX section (the fetch options object):
```js
                method: "POST",
                body: fd,
                credentials: "include",
                headers: {
```

Replace with:
```js
                method: "POST",
                body: fd,
                credentials: "include",
                signal: cascadeAbort.signal,
                headers: {
```

---

### Change 1C — Add race gate before Tier 2 navigation (around the `directAjaxUrl` variable)

Find this existing code:
```js
          const directAjaxUrl = `https://eservices.dda.org.in/user/step2_form/${currentSchemeId}/${locHash}/${secHash}/${pocHash}/${blkHash}/${twrHash}`;

          try {
            localStorage.removeItem("dda_direct_flat_url");
            delete window.__ddaDirectFlatUrl;
          } catch (_) {}

          ipcRenderer.send("dda:log", {
            level: "SUCCESS",
            pan: currentApplicant?.pan,
            page: "Locality Step 1",
            msg: `⚡ Tier 2 In-Page Fast AJAX Jump: ${directAjaxUrl}`,
          });
          window.location.replace(directAjaxUrl);
```

Replace with:
```js
          const directAjaxUrl = `https://eservices.dda.org.in/user/step2_form/${currentSchemeId}/${locHash}/${secHash}/${pocHash}/${blkHash}/${twrHash}`;

          // Race gate: check if Path A already won
          if (raceWon) return;
          raceWon = true;

          try {
            localStorage.removeItem("dda_direct_flat_url");
            delete window.__ddaDirectFlatUrl;
          } catch (_) {}

          const t2Elapsed = Date.now() - raceStartTime;
          ipcRenderer.send("dda:log", {
            level: "SUCCESS",
            pan: currentApplicant?.pan,
            page: "Locality Step 1",
            msg: `🏆 Path B Tier 2 WON in ${t2Elapsed}ms — AJAX Jump: ${directAjaxUrl}`,
          });
          appendRunLog(`🏆 [Locality Race] Path B (Tier 2) WON in ${t2Elapsed}ms — AJAX Jump`, "ROUTE");
          console.log(
            `%c🏆 [Locality Race] Path B (Tier 2) WON in ${t2Elapsed}ms — Cascade AJAX beat background resolver!`,
            "background:#2563eb; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
          );
          window.location.replace(directAjaxUrl);
```

---

### Change 1D — Add race gate between Tier 2 and Tier 3

Find this existing code (after the Tier 2 catch block closing brace):
```js
        }
      }

      function smartMatch(selectElement, targetText) {
```

Replace with:
```js
        }
      }

      // Race gate: if Path A won during Tier 2 execution (AbortError), skip Tier 3 entirely
      if (raceWon) return;

      function smartMatch(selectElement, targetText) {
```

---

### Change 1E — Add race gate before Tier 3 search submit

Find this code near the end of the Tier 3 DOM cascade (just before the `setTimeout` that clicks the search button):
```js
        } catch (_) {}

        setTimeout(() => {
          const searchBtn =
            document.getElementById("search") ||
```

Replace with:
```js
        } catch (_) {}

        // Race gate: check if Path A already won before submitting search
        if (raceWon) return;
        raceWon = true;

        const t3Elapsed = Date.now() - raceStartTime;
        appendRunLog(`🏆 [Locality Race] Path B (Tier 3) WON in ${t3Elapsed}ms — Cascade completed`, "ROUTE");
        console.log(
          `%c🏆 [Locality Race] Path B (Tier 3) WON in ${t3Elapsed}ms — DOM cascade beat background resolver!`,
          "background:#7c3aed; color:#fff; font-weight:bold; padding:4px 8px; border-radius:4px;",
        );
        ipcRenderer.send("dda:log", {
          level: "SUCCESS",
          pan: currentApplicant?.pan,
          page: "Locality Race",
          msg: `🏆 Path B (Tier 3) WON in ${t3Elapsed}ms — Cascade search submitted`,
        });

        setTimeout(() => {
          const searchBtn =
            document.getElementById("search") ||
```

---

## File 2: `src/store/useAuthStore.js`

Find the `logout` function's credential preservation section:

```js
  // Stage 3: App User Logout (Desktop App Sign Out)
  logout: async () => {
    // 1. Preserve saved login credentials vault (users.json)
    const loginUsersVault = localStorage.getItem('dda_login_users');

    // 2. Wipe all local storage & session storage clean
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}

    // 3. Restore the login credentials vault
    if (loginUsersVault) {
      try {
        localStorage.setItem('dda_login_users', loginUsersVault);
      } catch (_) {}
    }
```

Replace with:

```js
  // Stage 3: App User Logout (Desktop App Sign Out)
  logout: async () => {
    // 1. Preserve saved login credentials vault (users.json) & remember-me credentials
    const loginUsersVault = localStorage.getItem('dda_login_users');
    const rememberMeFlag = localStorage.getItem('dda_remember_me');
    const rememberedCreds = localStorage.getItem('dda_remembered_credentials');

    // 2. Wipe all local storage & session storage clean
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}

    // 3. Restore the login credentials vault & remember-me credentials
    if (loginUsersVault) {
      try {
        localStorage.setItem('dda_login_users', loginUsersVault);
      } catch (_) {}
    }
    if (rememberMeFlag) {
      try {
        localStorage.setItem('dda_remember_me', rememberMeFlag);
        if (rememberedCreds) localStorage.setItem('dda_remembered_credentials', rememberedCreds);
      } catch (_) {}
    }
```

---

## File 3: `src/views/WelcomeLogin.jsx`

### Change 3A — Move credential save BEFORE login call

Find:

```jsx
    try {
      const res = await performLogin(email.trim(), password);
      if (!res?.success) {
        setError(res?.error || 'Invalid credentials. Please try again.');
      } else {
        if (rememberMe) {
          try {
            localStorage.setItem('dda_remember_me', 'true');
            localStorage.setItem('dda_remembered_credentials', JSON.stringify({ email: email.trim(), password }));
          } catch (_) {}
        } else {
          try {
            localStorage.removeItem('dda_remember_me');
            localStorage.removeItem('dda_remembered_credentials');
          } catch (_) {}
        }
      }
```

Replace with:

```jsx
    try {
      // Save credentials BEFORE login call (component unmounts on success)
      if (rememberMe) {
        localStorage.setItem('dda_remember_me', 'true');
        localStorage.setItem('dda_remembered_credentials', JSON.stringify({ email: email.trim(), password }));
      }

      const res = await performLogin(email.trim(), password);
      if (!res?.success) {
        setError(res?.error || 'Invalid credentials. Please try again.');
        // Login failed — remove credentials if they were just saved
        if (rememberMe) {
          try {
            localStorage.removeItem('dda_remember_me');
            localStorage.removeItem('dda_remembered_credentials');
          } catch (_) {}
        }
      } else if (!rememberMe) {
        // Login succeeded but remember me is unchecked — clear any stale credentials
        try {
          localStorage.removeItem('dda_remember_me');
          localStorage.removeItem('dda_remembered_credentials');
        } catch (_) {}
      }
```

### Change 3B — Update the "Remember me" label

Find:
```jsx
                Remember me & save password
```

Replace with:
```jsx
                Remember me
```

---

## How to Apply on Your Main PC

1. Open your cloned repo on your main PC
2. Apply each change above to the respective file using find-and-replace
3. Run `npm install` to regenerate `package-lock.json`
4. Test with `npm run dev`
5. Commit and push:
   ```bash
   git add -A
   git commit -m "feat: parallel locality race engine + remember-me persistence fix"
   git push origin main
   ```

> [!TIP]
> Alternatively, you can save the raw unified diffs and apply them with `git apply`. If you'd like, I can also generate a `.patch` file you can transfer to your main PC.
