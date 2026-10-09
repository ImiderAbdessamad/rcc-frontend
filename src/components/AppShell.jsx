/* Coque applicative (charte Wafabail) : menu vertical sombre
   avec logo, contenu clair, barre d'onglets mobile. */

import { NavLink, useLocation, useNavigate } from "react-router-dom";
import Icon, { ICONS } from "./Icon.jsx";
import { initials } from "../lib/format.js";
import { useSession } from "../hooks/useSession.jsx";
import logoBlanc from "../assets/wafabail-logo-blanc.svg";
import heroChevron from "../assets/hero-chevron.svg";

const NAV = [
  { to: "/dossiers", key: "list", label: "Dossiers", tip: "Dossiers RCC", icon: ICONS.folder },
  { to: "/validation", key: "detail", label: "Validation", tip: "Validation des bilans", icon: ICONS.clipboardCheck },
  { to: "/import", key: "import", label: "Import", tip: "Import & extraction OCR", icon: ICONS.upload },
  { to: "/audit", key: "audit", label: "Audit", tip: "Historique & piste d'audit", icon: ICONS.history },
];

export default function AppShell({ lastDossierId, children }) {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const detailPath = lastDossierId ? `/validation/${encodeURIComponent(lastDossierId)}` : null;
  const isDetailActive = location.pathname.startsWith("/validation");

  function navTarget(item) {
    return item.key === "detail" ? detailPath : item.to;
  }

  function onNavClick(event, item) {
    event.preventDefault();
    const target = navTarget(item);
    if (target) navigate(target);
  }

  // Ferme la session Keycloak puis recharge l'application (retour sur la page de connexion).
  function onLogout() {
    logout();
  }

  const userName = user?.display_name || "Session";
  const userInitials = user?.initials || initials(user?.display_name);

  return (
    <div className="app">
      <nav className="rail" aria-label="Navigation principale">
        <div className="rail-brand">
          <img className="rail-logo" src={logoBlanc} alt="Wafabail" width="107" height="39" />
        </div>

        <div className="rail-nav">
          {NAV.map((item) => {
            const target = navTarget(item);
            const disabled = !target;
            const active = item.key === "detail" ? isDetailActive : location.pathname.startsWith(item.to);
            return (
              <button
                key={item.key}
                type="button"
                className="rail-btn"
                disabled={disabled}
                aria-current={active ? "page" : undefined}
                title={disabled ? "Ouvrez un dossier depuis la file" : undefined}
                onClick={(event) => onNavClick(event, item)}
              >
                <Icon paths={item.icon} size={16} width={1.8} />
                <span className="rail-label">{item.label}</span>
                <span className="rail-tip" role="tooltip">
                  {disabled ? "Ouvrez un dossier depuis la file" : item.tip}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rail-foot">
          <div className="rail-user">
            <span className="rail-avatar" aria-hidden="true">{userInitials}</span>
            <span className="rail-user-text">
              <strong>{userName}</strong>
              <small>Valideur RCC</small>
            </span>
          </div>
          <button type="button" className="rail-logout" onClick={onLogout}>
            <Icon paths={ICONS.logout} size={15} width={1.8} />
            <span className="rail-label">Déconnexion</span>
            <span className="rail-tip" role="tooltip">Se déconnecter</span>
          </button>
        </div>
      </nav>

      <main className="main">{children}</main>

      <nav className="tabbar" aria-label="Navigation">
        {NAV.map((item) => {
          const target = navTarget(item);
          const active = item.key === "detail" ? isDetailActive : location.pathname.startsWith(item.to);
          return (
            <button
              key={item.key}
              type="button"
              className="tabbar-btn"
              disabled={!target}
              aria-current={active ? "page" : undefined}
              onClick={(event) => onNavClick(event, item)}
            >
              <Icon paths={item.icon} size={18} width={1.8} />
              {item.label}
            </button>
          );
        })}
        <button type="button" className="tabbar-btn" onClick={onLogout}>
          <Icon paths={ICONS.logout} size={18} width={1.8} />
          Quitter
        </button>
      </nav>
    </div>
  );
}

/** Bandeau de titre commun aux écrans pleine largeur. */
export function TopBar({ title, subtitle, children }) {
  return (
    <header className="topbar topbar-hero">
      <HeroMark />
      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children ? <div className="topbar-actions">{children}</div> : null}
    </header>
  );
}

/** Motif du logo (chevron + carré), en filigrane du bandeau. */
export function HeroMark() {
  return (
    <span className="hero-mark" aria-hidden="true">
      <span className="hero-mark-square" />
      <img className="hero-mark-chevron" src={heroChevron} alt="" />
    </span>
  );
}

export { NavLink };
