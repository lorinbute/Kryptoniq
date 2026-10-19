// Who is signed in (FD-USERS). One query, ['auth'], drives the whole app: no user → the sign-in screens.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { AuthState, PublicUser } from '../shared/api-types.ts';
import { api, newSessionEpoch } from './api.ts';

/** Sent by the API client when the server answers 401 to a signed-in page (session ended elsewhere). */
export const SIGNED_OUT_EVENT = 'sentiq:signed-out';
/** Sent by the API client on 403 TWO_FACTOR_REQUIRED (FD-2FA): the auth state is read again, the setup shows. */
export const TWO_FACTOR_EVENT = 'sentiq:two-factor-required';

export const AUTH_KEY = ['auth'] as const;
/** The account requests waiting for the admin (FD-INVITE §1): the Users page and the account menu share it. */
export const REQUESTS_KEY = ['admin', 'account-requests'] as const;

export function useAuthState() {
  return useQuery({ queryKey: AUTH_KEY, queryFn: () => api.get<AuthState>('/api/auth/state'), staleTime: 5 * 60_000, retry: 1 });
}

/** The signed-in user (pages behind the sign-in always have one). */
export function useMe(): PublicUser | null {
  return useAuthState().data?.user ?? null;
}

export function useIsAdmin(): boolean {
  return useMe()?.role === 'admin';
}

/**
 * After a sign-in / sign-out: the new user goes into the auth state and every other query is dropped, so no data
 * of the previous user stays on screen or in the cache.
 */
export function useAuthChange() {
  const qc = useQueryClient();
  return useCallback(
    (user: PublicUser | null) => {
      newSessionEpoch();
      // The recovery codes of a setup never outlive the account they belong to on this screen.
      endEnrolment();
      const prev = qc.getQueryData<AuthState>(AUTH_KEY);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] });
      if (prev) qc.setQueryData<AuthState>(AUTH_KEY, { ...prev, user, setupNeeded: user ? false : prev.setupNeeded, setupHere: user ? false : prev.setupHere });
      void qc.invalidateQueries({ queryKey: AUTH_KEY });
    },
    [qc],
  );
}

/**
 * FD-2FA §1: a two-factor setup just finished. Its recovery codes stay on screen (with the account as it is now)
 * until the user says they are kept, even when the auth state is read again meanwhile and already has two-factor on.
 */
export interface Enrolment {
  codes: string[];
  user: PublicUser;
}
let enrolment: Enrolment | null = null;
const enrolmentListeners = new Set<() => void>();
const tellEnrolment = () => {
  for (const l of enrolmentListeners) l();
};
export function holdEnrolment(e: Enrolment): void {
  enrolment = e;
  tellEnrolment();
}
export function endEnrolment(): void {
  if (!enrolment) return;
  enrolment = null;
  tellEnrolment();
}
const subscribeEnrolment = (l: () => void) => {
  enrolmentListeners.add(l);
  return () => void enrolmentListeners.delete(l);
};
const currentEnrolment = () => enrolment;
export function useEnrolment(): Enrolment | null {
  return useSyncExternalStore(subscribeEnrolment, currentEnrolment);
}

/** A path inside the app to go to after signing in (never another site: "//evil.com" or "/\\evil.com"). */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.length > 300) return '/';
  if (AUTH_PATHS.some((p) => raw === p || raw.startsWith(`${p}?`))) return '/';
  return raw;
}

/**
 * Where to land once the new user reaches the app. Set just before `useAuthChange()(user)`: the sign-in page is then
 * replaced by a redirect to it. (Navigating at the same moment would race the auth update: the router moves in a
 * transition, the user arrives first, and a redirect computed from the old address would win.)
 */
let afterSignIn: string | null = null;
export function landAfterSignIn(path: string): void {
  afterSignIn = safeNext(path);
}
export function afterSignInTarget(): string | null {
  return afterSignIn;
}
export function clearAfterSignIn(): void {
  afterSignIn = null;
}

/**
 * The same for leaving on purpose (sign out, a new password): the sign-in page to show, without a `next` back to the
 * page left. A session that simply ended (401) keeps `next`, so signing in again returns there.
 */
let afterSignOut: string | null = null;
export function landAfterSignOut(path = '/login'): void {
  afterSignOut = path;
}
export function afterSignOutTarget(): string | null {
  return afterSignOut;
}
export function clearAfterSignOut(): void {
  afterSignOut = null;
}

/** The sign-in screens (shown to anybody). */
export const AUTH_PATHS = ['/login', '/request-account', '/activate', '/forgot', '/reset-password', '/setup', '/register', '/verify-email'];
