import path from 'path';
import { mkdir, copyFile } from 'fs/promises';
import { DB_DATA_DIR } from '../db/lowdb.js';

/** data/artifacts/{projectId}/last-dist.zip — 每次成功发布后覆盖 */
export function getLastDistZipPath(projectId) {
  return path.join(DB_DATA_DIR, 'artifacts', projectId, 'last-dist.zip');
}

export async function saveLastDistZip(projectId, sourceZipPath) {
  const dir = path.join(DB_DATA_DIR, 'artifacts', projectId);
  await mkdir(dir, { recursive: true });
  await copyFile(sourceZipPath, getLastDistZipPath(projectId));
}
