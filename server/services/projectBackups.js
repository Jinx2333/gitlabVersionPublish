import { createWriteStream, existsSync } from 'fs';
import { mkdir, readdir, rm, stat } from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import { NodeSSH } from 'node-ssh';
import { DB_DATA_DIR } from '../db/lowdb.js';
import { execSshCommand } from './sshRemote.js';

const MAX_BACKUPS_PER_PROJECT = 5;

function getProjectBackupDir(projectId) {
  return path.join(DB_DATA_DIR, 'backups', projectId);
}

export function getProjectBackupPath(projectId, filename) {
  return path.join(getProjectBackupDir(projectId), filename);
}

export async function deleteProjectBackup(projectId, filename) {
  const safeName = path.basename(String(filename ?? ''));
  if (!safeName || !safeName.endsWith('.zip')) {
    throw new Error('备份文件名无效');
  }
  await rm(getProjectBackupPath(projectId, safeName), { force: true });
}

function safeFilenamePart(raw) {
  return String(raw || 'project').replace(/[\\/:*?"<>|\s]+/g, '_');
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日-${pad(date.getHours())}时${pad(date.getMinutes())}分${pad(date.getSeconds())}秒`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function zipDirectory(sourceDir, outFile) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export async function listProjectBackups(projectId) {
  const dir = getProjectBackupDir(projectId);
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const rows = await Promise.all(
    names
      .filter((name) => name.endsWith('.zip'))
      .map(async (name) => {
        const filePath = path.join(dir, name);
        const s = await stat(filePath);
        return {
          filename: name,
          size: s.size,
          createdAt: s.mtime.toISOString(),
        };
      }),
  );
  return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function pruneProjectBackups(projectId) {
  const rows = await listProjectBackups(projectId);
  const expired = rows.slice(MAX_BACKUPS_PER_PROJECT);
  await Promise.all(
    expired.map((row) =>
      rm(getProjectBackupPath(projectId, row.filename), { force: true }),
    ),
  );
}

export async function createProjectBackup(project) {
  if (project.buildOnly) {
    throw new Error('只打包项目没有发布目录，无法创建远程备份');
  }
  const remoteBase = String(project.serverPath ?? '').trim().replace(/\/$/, '');
  if (!remoteBase) throw new Error('项目未配置服务器资源目录');
  if (!project.serverIp || !project.serverUser || !project.serverPassword) {
    throw new Error('项目服务器连接信息不完整');
  }

  const backupDir = getProjectBackupDir(project.id);
  await mkdir(backupDir, { recursive: true });

  const workRoot = path.join(os.tmpdir(), `fe-backup-${randomUUID()}`);
  const localDir = path.join(workRoot, 'remote');
  await mkdir(localDir, { recursive: true });

  const filename = `${safeFilenamePart(project.name)}${formatTimestamp()}Backup.zip`;
  const outFile = path.join(backupDir, filename);
  const ssh = new NodeSSH();
  let remoteDownloadDir = remoteBase;
  let remoteTempDir = null;
  let isBackupComplete = false;

  try {
    await ssh.connect({
      host: project.serverIp,
      username: project.serverUser,
      password: project.serverPassword,
      readyTimeout: 30000,
    });
    if (project.sshSudoSuRoot) {
      const switchPw = String(project.rootSwitchPassword ?? '').trim();
      if (!switchPw) throw new Error('项目未配置 root 切换密码，无法创建备份');
      const slug = String(project.id).replace(/-/g, '').slice(0, 12);
      remoteTempDir = `/tmp/fe-backup-${slug}-${Date.now()}`;
      const copyCmd = [
        `rm -rf ${shellQuote(remoteTempDir)}`,
        `mkdir -p ${shellQuote(remoteTempDir)}`,
        `cp -a ${shellQuote(`${remoteBase}/.`)} ${shellQuote(remoteTempDir)}/`,
        `chown -R ${shellQuote(project.serverUser)} ${shellQuote(remoteTempDir)}`,
      ].join(' && ');
      const copyRes = await execSshCommand(ssh, copyCmd, switchPw);
      if (copyRes.code !== 0) {
        throw new Error(`远程备份目录准备失败: ${copyRes.stderr || copyRes.stdout}`);
      }
      remoteDownloadDir = remoteTempDir;
    }
    const ok = await ssh.getDirectory(localDir, remoteDownloadDir, {
      recursive: true,
      concurrency: 4,
    });
    if (!ok) throw new Error('远程目录下载失败');
    await zipDirectory(localDir, outFile);
    await pruneProjectBackups(project.id);
    isBackupComplete = true;
    return {
      filename,
      size: await fileSize(outFile),
      createdAt: new Date().toISOString(),
    };
  } finally {
    if (remoteTempDir) {
      await execSshCommand(
        ssh,
        `rm -rf ${shellQuote(remoteTempDir)}`,
        project.rootSwitchPassword,
      ).catch(() => {});
    }
    ssh.dispose();
    if (!isBackupComplete) {
      await rm(outFile, { force: true }).catch(() => {});
    }
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function removeProjectBackups(projectId) {
  await rm(getProjectBackupDir(projectId), { recursive: true, force: true });
}
