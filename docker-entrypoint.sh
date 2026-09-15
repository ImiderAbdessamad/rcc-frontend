#!/bin/sh
set -eu

UPSTREAM="${API_UPSTREAM:-http://host.docker.internal:8002}"
sed "s|__API_UPSTREAM__|${UPSTREAM}|g" /etc/nginx/default.conf.tpl > /etc/nginx/conf.d/default.conf

exec "$@"
