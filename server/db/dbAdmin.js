/**
 * 数据库维护命令（在仓库根目录执行）
 *
 * init       — 仅创建/迁移 db.json，不删除任何业务数据
 * prune-junk — 删除无效或「空壳」项目（无 id，或项目名与 Git 地址均为空）
 * reset-all  — 清空 projects 与 deployLogs（需 --yes）
 */
import { mkdir, writeFile } from 'fs/promises';
import '../config/env.js';
import {
  getDb,
  DB_FILE_PATH,
  DB_DATA_DIR,
  invalidateDbCache,
} from './lowdb.js';
import { isValidStoredProject } from './projectHelpers.js';

const cmd = process.argv[2];

async function cmdInit() {
  await getDb();
  console.log('数据库已就绪（不会删除已有项目/日志）:', DB_FILE_PATH);
}

async function cmdPruneJunk() {
  const db = await getDb();
  const raw = db.data.projects ?? [];
  const kept = raw.filter(isValidStoredProject);
  const removed = raw.length - kept.length;
  db.data.projects = kept;
  await db.write();
  console.log(
    `已清理无效/空壳项目: ${raw.length} -> ${kept.length}（删除 ${removed} 条）`,
  );
  console.log('文件:', DB_FILE_PATH);
}

async function cmdResetAll() {
  const ok =
    process.argv.includes('--yes') || process.env.DB_RESET_CONFIRM === 'YES';
  if (!ok) {
    console.error(
      '危险：将清空全部项目与发布日志。确认请执行:\n' +
        '  npm run db:reset-all -- --yes\n' +
        '或: DB_RESET_CONFIRM=YES node server/db/dbAdmin.js reset-all',
    );
    process.exit(1);
  }
  await mkdir(DB_DATA_DIR, { recursive: true });
  const empty = { projects: [], deployLogs: [] };
  await writeFile(DB_FILE_PATH, `${JSON.stringify(empty, null, 2)}\n`);
  invalidateDbCache();
  console.log('已重置为空库:', DB_FILE_PATH);
  console.log('若 PM2 / Node 服务正在运行，请重启后再访问。');
}

if (cmd === 'init') {
  await cmdInit();
} else if (cmd === 'prune-junk') {
  await cmdPruneJunk();
} else if (cmd === 'reset-all') {
  await cmdResetAll();
} else {
  console.log(`用法（在仓库根目录）:
  npm run db:init
  npm run db:prune-junk
  npm run db:reset-all -- --yes

  说明: db:init 只负责建文件和字段迁移，不会清空已有配置。`);
  process.exit(cmd ? 1 : 0);
}
