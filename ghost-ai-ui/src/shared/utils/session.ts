/**
 * session.ts
 *
 * Client-side anonymous session manager.
 * Stores session tokens exclusively in sessionStorage so they self-destruct 
 * the moment the user closes the browser tab.
 */

const SESSION_KEY = 'ghost_ai_session_id';

/**
 * Safely generates or retrieves the active anonymous session ID.
 * Returns null if executed during Server-Side Rendering (SSR).
 */
export function getOrCreateSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    let sessionId = window.sessionStorage.getItem(SESSION_KEY);
    
    if (!sessionId) {
      // Generate a cryptographically secure random UUID client-side
      sessionId = window.crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    
    return sessionId;
  } catch (error) {
    console.error('Failed to access sessionStorage:', error);
    // Ephemeral in-memory fallback if sessionStorage is blocked (e.g., incognito)
    return 'ghost_temp_' + Math.random().toString(36).substring(2, 15);
  }
}

/**
 * Explicitly wipes the active session token from sessionStorage.
 */
export function destroySession(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}
