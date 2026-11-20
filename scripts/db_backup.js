#!/usr/bin/env node
/**
 * CLI utility for creating and restoring verified SQLite backups.
 *
 * Usage:
 *   node scripts/db_backup.js backup [destPath]
 *   node scripts/db_backup.js verify <backupPath>
 *   node scripts/db_backup.js restore <backupPath> [targetPath]
 */
import { createDatabaseBackup, restoreDatabaseBackup, verifyBackupFile } from '../server/systems/BackupService.js';

const [, , cmd = 'backup', arg1, arg2] = process.argv;

try {
  if (cmd === 'backup') {
    const res = createDatabaseBackup({ destPath: arg1 || null });
    console.log(`[Backup] Created verified backup (${res.bytes} bytes): ${res.path}`);
  } else if (cmd === 'verify') {
    if (!arg1) throw new Error('Usage: node scripts/db_backup.js verify <backupPath>');
    verifyBackupFile(arg1);
    console.log(`[Backup] Verified OK: ${arg1}`);
  } else if (cmd === 'restore') {
    if (!arg1) throw new Error('Usage: node scripts/db_backup.js restore <backupPath> [targetPath]');
    const res = restoreDatabaseBackup(arg1, arg2 ? { targetPath: arg2 } : {});
    console.log(`[Backup] Restored verified backup to: ${res.targetPath}`);
  } else {
    throw new Error(`Unknown command '${cmd}'. Expected: backup | verify | restore`);
  }
} catch (err) {
  console.error(`[Backup] Error: ${err.message}`);
  process.exit(1);
}
