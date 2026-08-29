#!/bin/bash
# 服务器端自动备份。挂进 crontab：
#   0 3 * * * /opt/lab-bench/deploy/backup.sh >> /var/log/lab-bench-backup.log 2>&1
#
# 备份的是 sqlite 库和上传的合同原件。
# 数据库用 .backup 命令而不是 cp —— WAL 模式下直接 cp 可能拿到不一致的快照。

set -euo pipefail

DB="${LAB_BENCH_DB:-/var/lib/lab-bench/lab.db}"
UPLOADS="${LAB_BENCH_UPLOADS:-/var/lib/lab-bench/uploads}"
DEST="${LAB_BENCH_BACKUP_DIR:-/var/backups/lab-bench}"
KEEP_DAYS=30

stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

sqlite3 "$DB" ".backup '$DEST/lab-$stamp.db'"
gzip -f "$DEST/lab-$stamp.db"

if [ -d "$UPLOADS" ]; then
  tar czf "$DEST/uploads-$stamp.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
fi

find "$DEST" -name 'lab-*.db.gz'      -mtime +$KEEP_DAYS -delete
find "$DEST" -name 'uploads-*.tar.gz' -mtime +$KEEP_DAYS -delete

echo "[$(date -Iseconds)] 备份完成：$DEST/lab-$stamp.db.gz"

# 提醒：备份留在同一台 ECS 上，机器挂了就一起没了。
# 建议再加一步同步到 OSS 或你自己的电脑，比如：
#   ossutil cp -r "$DEST" oss://your-bucket/lab-bench/ --update
