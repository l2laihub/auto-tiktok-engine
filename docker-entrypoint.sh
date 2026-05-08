#!/bin/sh
set -e

# The dashboard spawns child processes via `node --env-file=.env ...` (see
# dashboard/server.ts). In a container, env vars are injected by the
# orchestrator, not via a .env file — so we generate one from the environment
# before handing off to the actual command.

ENV_FILE="${ENV_FILE:-/app/.env}"

cat > "$ENV_FILE" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
GOOGLE_API_KEY=${GOOGLE_API_KEY}
SUNO_API_URL=${SUNO_API_URL}
SUNO_COOKIE=${SUNO_COOKIE}
TIKTOK_CLIENT_KEY=${TIKTOK_CLIENT_KEY}
TIKTOK_CLIENT_SECRET=${TIKTOK_CLIENT_SECRET}
TIKTOK_REDIRECT_URI=${TIKTOK_REDIRECT_URI}
TIKTOK_ACCESS_TOKEN=${TIKTOK_ACCESS_TOKEN}
OUTPUT_DIR=${OUTPUT_DIR:-./output}
SCHEDULE_CRON=${SCHEDULE_CRON:-0 10 * * 1,3,5}
SCHEDULE_ENABLED=${SCHEDULE_ENABLED:-true}
DASHBOARD_USER=${DASHBOARD_USER}
DASHBOARD_PASS=${DASHBOARD_PASS}
EOF

chmod 600 "$ENV_FILE"

exec "$@"
