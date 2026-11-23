import { useSyncExternalStore } from 'react';

/**
 * The signed-in user, like VgemsAI's AuthSession: logs in with email and password, keeps the short-lived access
 * token in memory, and renews it with the refresh token shortly before it runs out. The refresh token is an
 * httpOnly cookie the API sets, so scripts on the page never see it; it also restores the login on reload.
 */
export interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  /** Seconds until the refresh cookie expires */
  refreshExpiresIn: number;
  user: User;
}

export interface SessionState {
  status: 'checking' | 'signedOut' | 'signedIn';
  user: User | null;
  /** Why the user was signed out, e.g. the login ended on the server */
  notice?: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The API's own wording, e.g. "Invalid email or password" */
export async function apiError(response: Response): Promise<ApiError> {
  let message = `Request failed (HTTP ${response.status})`;
  try {
    const body = await response.json() as { error?: string };
    message = body.error || message;
  } catch { /* Not JSON */ }
  return new ApiError(response.status, message);
}

const json = { 'Content-Type': 'application/json', Accept: 'application/json' };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Session {
  private state: SessionState = { status: 'checking', user: null };
  private token: { value: string; renewAt: number } | null = null;
  /** The renewal in progress. Only one runs at a time: the API ends the login when a refresh token is used twice. */
  private renewal: Promise<string> | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getState = () => this.state;

  /** On page load: logs back in with the refresh cookie, if there's a valid one */
  async restore(): Promise<void> {
    // The API sets this readable cookie next to the httpOnly refresh cookie; without it there's nothing to renew
    if (!document.cookie.split(';').some(cookie => cookie.trim().startsWith('schoolscope_signed_in='))) {
      this.set({ status: 'signedOut', user: null });
      return;
    }
    try {
      await this.renew();
    } catch {
      if (this.state.status === 'checking') this.set({ status: 'signedOut', user: null });
    }
  }

  /** Throws `ApiError` 401 for a wrong email or password, 429 after too many attempts */
  async logIn(email: string, password: string): Promise<void> {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
    if (!response.ok) throw await apiError(response);
    this.start(await response.json() as AuthResponse);
  }

  /** Ends the login on the server too (best effort: offline still signs out here) */
  logOut(): void {
    const token = this.token?.value;
    this.end();
    fetch('/api/auth/logout', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {});
  }

  /**
   * Calls the API with a valid access token. If the API rejects it anyway (e.g. after a server restart), the
   * token is renewed once and the call tried again.
   */
  async withAccessToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    try {
      return await call(await this.accessToken());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return call(await this.renew());
      throw error;
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.renewAt > Date.now()) return this.token.value;
    return this.renew();
  }

  /** Exchanges the refresh cookie for new tokens. Joins a renewal that's already running. */
  private renew(): Promise<string> {
    this.renewal ??= this.runRenewal().finally(() => { this.renewal = null; });
    return this.renewal;
  }

  private async runRenewal(): Promise<string> {
    // Other tabs share the cookie: take turns, so each sends the newest one
    const refresh = () => {
      const send = () => fetch('/api/auth/refresh', { method: 'POST', headers: { Accept: 'application/json' } });
      return navigator.locks ? navigator.locks.request('schoolscope-refresh', send) : send();
    };
    let response = await refresh();
    // 409: another tab renewed at the same moment, and the browser now has its new cookie
    for (let attempt = 0; response.status === 409 && attempt < 3; attempt++) {
      await wait(250 * (attempt + 1));
      response = await refresh();
    }
    if (!response.ok) {
      const error = await apiError(response);
      if (response.status === 401) {
        // The login ended: expired, logged out elsewhere, or the password changed. Offline keeps the session.
        this.end(this.state.status === 'signedIn' ? 'Your session ended. Please log in again.' : undefined);
      }
      throw error;
    }
    return this.start(await response.json() as AuthResponse);
  }

  private start(response: AuthResponse): string {
    const lifetime = response.expiresIn * 1000;
    // A minute early, or a tenth of the lifetime if that's shorter
    this.token = { value: response.accessToken, renewAt: Date.now() + Math.max(lifetime - 60_000, lifetime * 0.9) };
    this.set({ status: 'signedIn', user: response.user });
    return response.accessToken;
  }

  private end(notice?: string): void {
    this.token = null;
    // Also when the logout request can't reach the API: the next page load then shows the login page
    document.cookie = 'schoolscope_signed_in=; Max-Age=0; Path=/; SameSite=Strict';
    this.set({ status: 'signedOut', user: null, notice });
  }

  private set(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export const session = new Session();

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState);
}
