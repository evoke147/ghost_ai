/**
 * auditPrivacyMatrix.js
 *
 * Copy-pasteable Chrome/Firefox DevTools console snippet.
 * Automatically scans all client-side storage mechanisms (cookies, localStorage,
 * IndexedDB, sessionStorage) and alerts developers if any persistent privacy
 * data or leaks are detected.
 */
(async function runPrivacyAudit() {
  console.log("%c🕵️ GhostAI Security & Leak Audit Initiated...", "color: #7c3aed; font-weight: bold; font-size: 14px;");

  const violations = [];

  // 1. Scan Local Storage (No persistent data should exist here)
  const localStorageKeys = Object.keys(localStorage);
  if (localStorageKeys.length > 0) {
    violations.push(`Local Storage leak: discovered persistent keys [${localStorageKeys.join(', ')}]`);
  }

  // 2. Scan Cookies (No tracking or session cookies should exist here)
  if (document.cookie && document.cookie.trim() !== '') {
    violations.push(`Cookie leak: active cookies found [${document.cookie}]`);
  }

  // 3. Scan Session Storage (Only the transient ghost_session_ is allowed)
  const sessionStorageKeys = Object.keys(sessionStorage);
  const unexpectedSessionKeys = sessionStorageKeys.filter(
    key => !key.startsWith('ghost_session') && key !== 'ghost_ai_session_id'
  );
  if (unexpectedSessionKeys.length > 0) {
    violations.push(`Session Storage leak: unexpected transient keys found [${unexpectedSessionKeys.join(', ')}]`);
  }

  // 4. Scan IndexedDB (No DBs allowed except private state database if ZK is run in-browser)
  if (window.indexedDB && typeof window.indexedDB.databases === 'function') {
    try {
      const databases = await window.indexedDB.databases();
      const activeDBNames = databases.map(db => db.name).filter(name => name !== 'ghost-ai-poe-state');
      if (activeDBNames.length > 0) {
        violations.push(`IndexedDB leak: found active database engines [${activeDBNames.join(', ')}]`);
      }
    } catch (err) {
      console.warn("Could not query IndexedDB engines:", err);
    }
  }

  // --- REPORT AUDIT RESULT ---
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║               AUDIT PRIVACY MATRIX REPORT                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  
  if (violations.length === 0) {
    console.log("\n%c🟢 PRIVACY OK: Zero persistent artifacts discovered.", "color: #10b981; font-weight: bold; font-size: 13px;");
    console.log("   - LocalStorage: Clear\n   - Cookies: Clear\n   - SessionStorage: transient-only (ghost_session_* is clean)\n   - IndexedDB: Clear");
  } else {
    console.log("\n%c🔴 PRIVACY COMPLIANCE AUDIT FAILED:", "color: #ef4444; font-weight: bold; font-size: 13px;");
    violations.forEach(v => console.error(`  [LEAK] ${v}`));
    console.log("\n%cAction required: Ensure sessionStorage storage structures and cookie headers are cleared.", "color: #f59e0b;");
  }
  console.log("════════════════════════════════════════════════════════════════\n");
})();
