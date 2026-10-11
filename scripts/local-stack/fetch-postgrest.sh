#!/usr/bin/env bash
# Downloads the PostgREST binary (the REST layer inside Supabase) into .cache/postgrest, verifying a pinned
# SHA-256, so the local stack and CI run the exact same artefact. No Docker needed.
set -euo pipefail
VERSION="v12.2.3"
SHA256="9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/.cache/postgrest"
BIN="$DIR/postgrest"
[ -x "$BIN" ] && exit 0
mkdir -p "$DIR"
ARCHIVE="$DIR/postgrest.tar.xz"
curl -fsSL --retry 3 -o "$ARCHIVE" "https://github.com/PostgREST/postgrest/releases/download/$VERSION/postgrest-$VERSION-linux-static-x64.tar.xz"
echo "$SHA256  $ARCHIVE" | sha256sum -c - >/dev/null || { echo "PostgREST checksum mismatch — refusing to run it" >&2; rm -f "$ARCHIVE"; exit 1; }
tar -xJf "$ARCHIVE" -C "$DIR" postgrest
rm -f "$ARCHIVE"
chmod +x "$BIN"
