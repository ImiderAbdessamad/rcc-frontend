/* Authentification Keycloak (realm RCC) : connexion, token, déconnexion. */

import Keycloak from "keycloak-js";

/*
 * keycloak-js appelle crypto.randomUUID() à chaque connexion. Le navigateur ne
 * l'expose que sur une page sécurisée (https ou localhost) : sur le serveur dev
 * en http://IP, on le reconstruit à partir de crypto.getRandomValues(), qui
 * reste disponible et offre le même aléa.
 */
if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** Configuration injectée au démarrage du conteneur (public/config.js), sinon valeurs dev. */
const runtime = window.__RCC_CONFIG__ || {};

export const keycloak = new Keycloak({
  url: runtime.keycloakUrl || import.meta.env.VITE_KEYCLOAK_URL || "https://keycloak.app-dev.wafabail.ma",
  realm: runtime.keycloakRealm || import.meta.env.VITE_KEYCLOAK_REALM || "rcc",
  clientId: runtime.keycloakClientId || import.meta.env.VITE_KEYCLOAK_CLIENT_ID || "rcc-wb",
});

// Retour sans hash : le HashRouter occupe le fragment, Keycloak répond en query (?code=…).
const APP_ROOT = `${window.location.origin}/`;
const RETURN_KEY = "rcc.auth.returnHash";

let initPromise = null;

function rememberLocation() {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.hash);
  } catch {
    /* stockage indisponible : retour sur l'écran d'accueil */
  }
}

function restoreLocation() {
  try {
    const hash = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (hash && hash !== "#" && hash !== "#/") window.location.replace(hash);
  } catch {
    /* stockage indisponible */
  }
}

/** Redirige vers la page de connexion Keycloak, puis revient sur l'écran courant. */
export function login() {
  rememberLocation();
  return keycloak.login({ redirectUri: APP_ROOT });
}

/** Ferme la session Keycloak (SSO compris) et revient sur l'application. */
export function logout() {
  return keycloak.logout({ redirectUri: APP_ROOT });
}

/**
 * Initialise Keycloak une seule fois (StrictMode monte les effets deux fois).
 * Sans session, redirige vers Keycloak : la promesse ne se résout alors jamais.
 */
export function initAuth() {
  initPromise ??= (async () => {
    const authenticated = await keycloak.init({
      responseMode: "query",
      // PKCE exige crypto.subtle, absent en http://IP : activé seulement sur page sécurisée.
      pkceMethod: window.isSecureContext ? "S256" : false,
      checkLoginIframe: false,
      redirectUri: APP_ROOT,
    });
    if (!authenticated) {
      await login();
      return new Promise(() => {});
    }
    restoreLocation();
    return true;
  })();
  return initPromise;
}

/**
 * Access token valide pour au moins 30 s, rafraîchi si besoin. Si le
 * rafraîchissement échoue (session Keycloak expirée), le token courant est
 * renvoyé : le 401 du backend ramène alors à l'écran de reconnexion.
 */
export async function getToken() {
  if (!keycloak.authenticated) return null;
  try {
    await keycloak.updateToken(30);
  } catch {
    /* session expirée côté Keycloak */
  }
  return keycloak.token ?? null;
}
