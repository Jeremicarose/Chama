'use client';

const SESSION_KEY = 'chama.browserSession';

function generateSessionToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getBrowserSessionToken(): string {
  if (typeof window === 'undefined') return '';

  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const token = generateSessionToken();
  window.localStorage.setItem(SESSION_KEY, token);
  return token;
}
