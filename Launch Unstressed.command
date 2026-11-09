#!/bin/zsh
cd "$(dirname "$0")/mobile" || exit 1
if [ -x "$HOME/.nvm/versions/node/v22.16.0/bin/node" ]; then
  export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"
fi
export EXPO_NO_TELEMETRY=1
npm run start:go
