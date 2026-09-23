/*
 * Écran de reconnexion. La saisie des identifiants se fait sur la page
 * Keycloak : cet écran n'apparaît qu'après une session expirée ou un refus
 * d'accès (compte sans rôle RCC, API injoignable).
 */

import { useState } from "react";
import { useSession } from "../hooks/useSession.jsx";

function errorMessage(error) {
  if (!error) return "";
  if (error.status === 403) {
    return "Votre compte est bien authentifié, mais il n'a pas accès à l'application RCC. "
      + "Demandez l'habilitation RCC à votre administrateur.";
  }
  if (error.status === 401) {
    // Session Keycloak valide mais jeton refusé par l'API : se reconnecter
    // relancerait la même session, d'où la déconnexion Keycloak proposée.
    return "Le serveur RCC a refusé votre connexion. Reconnectez-vous ; "
      + "si le problème persiste, contactez l'administrateur.";
  }
  return error.message;
}

export default function Login() {
  const { login, logout, expiredMessage, accessError } = useSession();
  const [busy, setBusy] = useState(false);

  const forbidden = accessError?.status === 403;
  const rejected = !expiredMessage && accessError?.status === 401;
  const message = expiredMessage || errorMessage(accessError);

  function onLogin() {
    setBusy(true);
    login();
  }

  function onSwitchAccount() {
    setBusy(true);
    logout();
  }

  return (
    <div className="login">
      <div className="login-brand">
        <div className="login-logo">
          <span className="login-logo-mark" aria-hidden="true">E</span>
          <span className="login-logo-text">
            EKIP<span className="muted"> · Validation RCC</span>
          </span>
        </div>

        <div className="login-pitch">
          <p className="login-eyebrow">Risque de contrepartie</p>
          <h1>Contrôle humain des bilans extraits par OCR.</h1>
          <p className="login-lede">
            Vérifiez les postes financiers extraits de la liasse fiscale, corrigez les
            valeurs mal reconnues et validez la cohérence comptable avant enrichissement
            du modèle EKIP.
          </p>
        </div>

        <dl className="login-stats">
          <div>
            <dt>20</dt>
            <dd>postes RCC contrôlés</dd>
          </div>
          <div>
            <dt>8</dt>
            <dd>contrôles comptables</dd>
          </div>
          <div>
            <dt>100 %</dt>
            <dd>piste d'audit</dd>
          </div>
        </dl>

        <span className="login-ring login-ring-a" aria-hidden="true" />
        <span className="login-ring login-ring-b" aria-hidden="true" />
      </div>

      <div className="login-panel">
        <div className="login-form">
          <h2>{forbidden ? "Accès refusé" : "Se connecter"}</h2>
          <p className="login-sub">Accès réservé aux valideurs RCC habilités.</p>

          <p id="loginError" className="form-error" role="alert" hidden={!message}>
            {message}
          </p>

          <button
            type="button"
            className={`btn btn-primary btn-block${busy ? " is-busy" : ""}`}
            disabled={busy}
            onClick={forbidden || rejected ? onSwitchAccount : onLogin}
          >
            <span className="btn-label">
              {forbidden
                ? "Se connecter avec un autre compte"
                : rejected ? "Se reconnecter" : "Se connecter avec Keycloak"}
            </span>
            <span className="btn-spinner" aria-hidden="true" />
          </button>

          <p className="login-note">
            Toute action de validation est horodatée et tracée au nom de l'utilisateur
            connecté.
          </p>
        </div>
      </div>
    </div>
  );
}
