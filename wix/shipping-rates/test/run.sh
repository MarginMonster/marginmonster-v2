#!/bin/sh
# Runs the shipping rate maths under Node. The Velo source has no bare
# specifiers, so it is copied to .tmp unchanged and only renamed to .mjs.
set -e
cd "$(dirname "$0")"
rm -rf .tmp && mkdir -p .tmp
cp ../backend/ecom-shipping-rates.js .tmp/ecom-shipping-rates.mjs
node --test rates.test.mjs
