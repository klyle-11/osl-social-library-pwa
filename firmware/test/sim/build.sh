#!/usr/bin/env sh
# Builds the desktop drop point and modem used by `npm run rehearse:radio`.
#   sh firmware/test/sim/build.sh <out dir>
set -e
cd "$(dirname "$0")/.."
if [ ! -d .deps/ArduinoJson ]; then
  git clone -q --depth 1 -b v7.2.1 https://github.com/bblanchon/ArduinoJson.git .deps/ArduinoJson
fi
OUT="${1:-${TMPDIR:-/tmp}}"
mkdir -p "$OUT"
FLAGS="-std=c++17 -O1 -Wall -Wextra -Wno-maybe-uninitialized -I.deps/ArduinoJson/src -I../lib/osl_link/src"
LIBS="../lib/osl_node/src/osl_store.cpp ../lib/osl_node/src/osl_api.cpp ../lib/osl_node/src/osl_ops.cpp ../lib/osl_node/src/osl_status.cpp ../lib/osl_link/src/osl_link.cpp"
c++ $FLAGS -o "$OUT/osl_droppoint_sim" sim/droppoint_sim.cpp $LIBS
c++ $FLAGS -o "$OUT/osl_modem_sim" sim/modem_sim.cpp ../lib/osl_link/src/osl_link.cpp
