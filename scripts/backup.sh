#!/bin/sh
# Ma'lumotlar bazasi va yuklangan fayllar zaxirasi. Cron orqali har kuni ishga tushiring:
#   0 3 * * * cd /opt/nazarov-tg-gifts && ./scripts/backup.sh >> backups/backup.log 2>&1
set -eu
DIR="$(dirname "$0")/../backups"
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U ng -d ng -Fc > "$DIR/db-$TS.dump"
docker compose run --rm --no-deps -v "$(cd "$DIR" && pwd)":/backup app sh -c "tar czf /backup/uploads-$TS.tgz -C /data uploads"
# 30 kundan eski zaxiralarni o'chirish
find "$DIR" -name 'db-*.dump' -mtime +30 -delete
find "$DIR" -name 'uploads-*.tgz' -mtime +30 -delete
echo "Zaxira tayyor: $TS"
