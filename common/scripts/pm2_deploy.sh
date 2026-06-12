#!/usr/bin/env bash

set -e # exit if any command fails

if [[ "$1" != "menu" && "$1" != "builder" ]]; then
    echo "Please specify which app you're trying to deploy: 'menu' | 'builder'"
    exit 1
fi

export NVM_DIR="$HOME/.nvm"

[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # loads NVM

# adds the monorepo scripts dir to path
# useful for any custom scripts that we've defined
# and for `install-run-rush|x.js`
PATH=$PATH":$PWD/common/scripts"

APP_PATH="apps/$1"

rush install
rush build

cd "$APP_PATH"

rushx build:prod

pm2 startOrReload ecosystem.config.cjs --env production # start or reload the demonised app
