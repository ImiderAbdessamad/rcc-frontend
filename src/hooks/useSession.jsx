/* Session analyste : connexion Keycloak au démarrage, profil, expiration, déconnexion. */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import * as api from "../lib/api.js";
import * as auth from "../lib/auth.js";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [expiredMessage, setExpiredMessage] = useState("");
  // Erreur au chargement du profil : compte sans rôle RCC (403), API injoignable…
  const [accessError, setAccessError] = useState(null);

  // Un 401 sur n'importe quelle route ramène à l'écran de reconnexion.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setUser((current) => {
        if (current) {
          setExpiredMessage("Votre session a expiré. Reconnectez-vous pour continuer.");
        }
        return null;
      });
    });
    return () => api.setUnauthorizedHandler(null);
  }, []);

  // Sans session Keycloak, initAuth redirige vers la page de connexion.
  useEffect(() => {
    let cancelled = false;
    auth
      .initAuth()
      .then(() => api.auth.me())
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((error) => {
        if (!cancelled) setAccessError(error);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => auth.login(), []);
  const logout = useCallback(() => auth.logout(), []);

  const value = useMemo(
    () => ({ user, booting, login, logout, expiredMessage, accessError }),
    [user, booting, login, logout, expiredMessage, accessError]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession doit être utilisé dans un SessionProvider.");
  return context;
}
