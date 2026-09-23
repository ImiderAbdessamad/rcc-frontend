/*
 * Configuration lue au démarrage (src/lib/auth.js). En Docker, ce fichier est
 * réécrit par docker-entrypoint.sh à partir des variables KEYCLOAK_*.
 * Vide ici : les valeurs par défaut (Keycloak dev, realm rcc, client rcc-wb) s'appliquent.
 */
window.__RCC_CONFIG__ = window.__RCC_CONFIG__ || {};
