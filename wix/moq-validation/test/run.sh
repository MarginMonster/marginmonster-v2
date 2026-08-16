#!/bin/sh
# Runs the MOQ rules under Node. The Velo source uses Wix's bare-specifier
# import ('backend/moq-data.js'), which Node can't resolve, so the files are
# copied into .tmp with that one import rewritten. Nothing else is changed.
set -e
cd "$(dirname "$0")"
rm -rf .tmp && mkdir -p .tmp
sed "s#from 'backend/moq-data.js'#from './moq-data.mjs'#" ../backend/ecom-validations.js > .tmp/ecom-validations.mjs
cp ../backend/moq-data.js .tmp/moq-data.mjs
cp moq.test.mjs toys.test.mjs .tmp/
node .tmp/moq.test.mjs
node .tmp/toys.test.mjs
