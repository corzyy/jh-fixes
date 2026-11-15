#!/bin/bash
# Re-runs `make install` whenever something in src/ or loader/ changes.
set -uo pipefail
cd "$(dirname "$0")/.."

stamp() {
    find src loader -type f ! -name gschemas.compiled -printf '%T@ %p\n' 2>/dev/null | sort | md5sum
}

last=$(stamp)
echo "Watching src/ and loader/ for changes (Ctrl+C to stop)..."
while true; do
    sleep 1
    now=$(stamp)
    if [[ $now != "$last" ]]; then
        sleep 0.3          # let editors finish writing
        last=$(stamp)
        echo "--- change detected $(date +%T) ---"
        make --no-print-directory install || echo "!!! install failed"
    fi
done
