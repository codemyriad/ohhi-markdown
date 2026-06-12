#!/bin/sh

# This script is invoked by cloudflare pages to build the menu viewer app

export DEPLOY_ADAPTER=cloudflare

echo "Running build"

echo "Installing packages (running rush update)"
./common/scripts/rush update

echo "Building dependencies (running rush build)"
./common/scripts/rush build

echo "Building builder app"
cd apps/builder
../../common/scripts/rushx build:prod

echo "Output from the Cloudflare adapter:"
find .svelte-kit/cloudflare
