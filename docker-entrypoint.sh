#!/bin/sh
set -eu

UPSTREAM="${API_UPSTREAM:-http://host.docker.internal:8002}"
sed "s|__API_UPSTREAM__|${UPSTREAM}|g" /etc/nginx/default.conf.tpl > /etc/nginx/conf.d/default.conf

# Configuration Keycloak lue par le navigateur (src/lib/auth.js). Variable vide = défaut dev.
cat > /usr/share/nginx/html/config.js <<EOF
window.__RCC_CONFIG__ = {
  keycloakUrl: "${KEYCLOAK_URL:-}",
  keycloakRealm: "${KEYCLOAK_REALM:-}",
  keycloakClientId: "${KEYCLOAK_CLIENT_ID:-}"
};
EOF

exec "$@"
