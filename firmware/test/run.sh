#!/usr/bin/env sh
# Runs the firmware's portable logic on your computer (no board needed):
#   - link_sim: the LoRa link over a simulated lossy radio
#   - node_test: the drop point's op log and /sync handling
# Needs a C++ compiler and ArduinoJson (fetched once into firmware/test/.deps).
set -e
cd "$(dirname "$0")"
if [ ! -d .deps/ArduinoJson ]; then
  git clone -q --depth 1 -b v7.2.1 https://github.com/bblanchon/ArduinoJson.git .deps/ArduinoJson
fi
OUT="${TMPDIR:-/tmp}"
FLAGS="-std=c++17 -O1 -Wall -Wextra -Wno-maybe-uninitialized -fsanitize=address,undefined"
c++ $FLAGS -o "$OUT/osl_link_sim" link_sim.cpp ../lib/osl_link/src/osl_link.cpp
c++ $FLAGS -I.deps/ArduinoJson/src -I../lib/osl_link/src -o "$OUT/osl_node_test" node_test.cpp ../lib/osl_node/src/osl_store.cpp ../lib/osl_node/src/osl_sync.cpp ../lib/osl_link/src/osl_link.cpp
"$OUT/osl_node_test"
"$OUT/osl_link_sim"
