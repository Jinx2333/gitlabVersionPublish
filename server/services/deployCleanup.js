import { readdir, stat, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { getDeployWorkRootBase } from '../config/env.js';

const PREFIX = 'fe-deploy-';
/** 超过该时间未修改的临时目录视为残留，下次部署前删除（避免并发任务互相删除，取较保守值） */
const STALE_MS = 25 * 60 * 1000;

async function cleanupFeDeployDirsUnder(baseDir) {
  let entries;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(PREFIX)) continue;
    const full = path.join(baseDir, e.name);
    try {
      const s = await stat(full);
      if (now - s.mtimeMs > STALE_MS) {
        await rm(full, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * 清理 fe-deploy-* 工作目录（系统 Temp + 部署专用根目录，见 getDeployWorkRootBase）
 */
export async function cleanupStaleDeployWorkdirs() {
  const bases = new Set([os.tmpdir(), getDeployWorkRootBase()]);
  for (const dir of bases) {
    await cleanupFeDeployDirsUnder(dir);
  }
}
