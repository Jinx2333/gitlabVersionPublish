import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdir } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 仓库根目录下的 data/（与 server 同级） */
export const DB_DATA_DIR = join(__dirname, '..', '..', 'data');
export const DB_FILE_PATH = join(DB_DATA_DIR, 'db.json');
const dataDir = DB_DATA_DIR;
const dbPath = DB_FILE_PATH;

const defaultData = {
  projects: [],
  deployLogs: [],
};

function migrateData(data) {
  if (!data) return;
  if (!Array.isArray(data.deployLogs)) {
    data.deployLogs = [];
  }
  for (const p of data.projects ?? []) {
    if (p.lastSuccessAt === undefined) p.lastSuccessAt = null;
    if (p.lastDeployStatus === undefined) p.lastDeployStatus = null;
    if (p.lastDeployAt === undefined) p.lastDeployAt = null;
    if (p.lastDeployError === undefined) p.lastDeployError = null;
    if (p.loginUrl === undefined) p.loginUrl = '';
    if (p.bizCategory === undefined) p.bizCategory = 'other';
  }
}

let dbInstance;

/** 下次 getDb() 重新读盘（重置文件后若需在同进程重载可调用） */
export function invalidateDbCache() {
  dbInstance = undefined;
}

export async function getDb() {
  if (dbInstance) return dbInstance;
  await mkdir(dataDir, { recursive: true });
  const adapter = new JSONFile(dbPath);
  const db = new Low(adapter, defaultData);
  await db.read();
  db.data ||= { ...defaultData };
  db.data.projects ||= [];
  migrateData(db.data);
  await db.write();
  dbInstance = db;
  return db;
}
