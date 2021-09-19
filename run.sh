#!/usr/bin/env bash
set -e
set -x

[ -z "$APP_HOME" ] && export APP_HOME=$(pwd)

[ -z "$MONGODB_ADDON_URI" ] && export MONGODB_URI="$MONGODB_ADDON_URI"
[ -z "$REDIS_URL" ] && export REDIS_URL="$REDIS_URL"
[ -z "$PORT" ] && export PORT="8080"

npm run start
