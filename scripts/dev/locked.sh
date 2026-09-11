#!/bin/sh
# Serialises Electron builds / smoke runs across parallel agents: scripts/dev/locked.sh <cmd...>
LOCK=/tmp/kestrel-build.lock
i=0
while ! mkdir "$LOCK" 2>/dev/null; do
  i=$((i+1))
  if [ $i -gt 600 ]; then echo "locked.sh: giving up waiting for $LOCK" >&2; exit 1; fi
  perl -e 'select(undef,undef,undef,0.5)'
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM
"$@"
