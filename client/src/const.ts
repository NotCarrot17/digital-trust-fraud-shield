export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const FRAUD_API_BASE_URL = (() => {
  const configured = import.meta.env.VITE_FRAUD_API_BASE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:8000';
  // Opened from another device on the same network: talk to the helper on the same machine serving this page.
  return `${window.location.protocol}//${host}:8000`;
})();

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};