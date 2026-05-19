import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, rm, access } from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import simpleGit from 'simple-git';
import { NodeSSH } from 'node-ssh';
import { getGitlabAuth, getNvmHome, getDeployWorkRootBase } from '../config/env.js';
import { cleanupStaleDeployWorkdirs } from './deployCleanup.js';
import { summarizeRecentCommitters } from './gitRecentAuthors.js';
import { saveLastDistZip } from './projectArtifacts.js';
import { createProjectBackup } from './projectBackups.js';
import { execSshCommand } from './sshRemote.js';

/**
 * 将常见内网 / SSH 写法规范成可用 HTTP 克隆地址（再嵌入账号密码）
 */
export function normalizeGitUrlToHttp(rawUrl) {
  let url = String(rawUrl ?? '').trim();
  if (!url) {
    throw new Error('Git 地址为空');
  }

  // SCP 形式：git@host:group/repo.git → http://host/group/repo.git
  const scp = /^git@([^:]+):(.+)$/i.exec(url);
  if (scp) {
    const host = scp[1];
    const repoPath = scp[2].replace(/^\/+/, '');
    return `http://${host}/${repoPath}`;
  }

  // ssh://git@host/path/repo.git → http://host/path/repo.git
  const sshGit = /^ssh:\/\/git@([^/]+)\/(.+)$/i.exec(url);
  if (sshGit) {
    const host = sshGit[1];
    const repoPath = sshGit[2].replace(/^\/+/, '');
    return `http://${host}/${repoPath}`;
  }

  // 已带协议
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  // 无协议：内网常填 host/group/repo.git，默认按 HTTP
  const withoutLeadingSlashes = url.replace(/^\/+/, '');
  return `http://${withoutLeadingSlashes}`;
}

/**
 * 使用内置 GitLab 账号密码构造带 Basic 认证的克隆 URL（支持 http / https；内网可无协议或 SSH 形式）
 */
export function buildAuthenticatedGitUrl(rawUrl, user, pwd) {
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(pwd);
  const url = normalizeGitUrlToHttp(rawUrl);
  if (url.startsWith('https://')) {
    return url.replace(/^https:\/\//i, `https://${u}:${p}@`);
  }
  if (url.startsWith('http://')) {
    return url.replace(/^http:\/\//i, `http://${u}:${p}@`);
  }
  throw new Error('无法解析为 http(s) 的 Git 地址，请检查格式');
}

/**
 * 在隔离 Node 版本的同时，尽量让 pnpm / 全局 npm 包可被找到（pnpm install 等）
 */
function toolPathPrefixes(targetNodePath) {
  const prefixes = [targetNodePath];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      const npmRoaming = path.join(appData, 'npm');
      if (existsSync(npmRoaming)) {
        prefixes.push(npmRoaming);
      }
    }
    const localApp = process.env.LOCALAPPDATA;
    if (localApp) {
      const pnpmHome = path.join(localApp, 'pnpm');
      if (existsSync(pnpmHome)) {
        prefixes.push(pnpmHome);
      }
    }
  } else {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.local', 'share', 'pnpm'),
      path.join(home, '.pnpm'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        prefixes.push(c);
      }
    }
  }
  if (process.env.PNPM_HOME && existsSync(process.env.PNPM_HOME)) {
    prefixes.push(process.env.PNPM_HOME);
  }
  return [...new Set(prefixes)];
}

export function createIsolatedNodeEnv(nodeVersion) {
  const nvmHome = getNvmHome();
  const targetNodePath = path.join(nvmHome, 'v' + nodeVersion);
  const env = { ...process.env };
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const current = env[pathKey] ?? '';
  const prefix = toolPathPrefixes(targetNodePath).join(path.delimiter);
  env[pathKey] = [prefix, current].filter(Boolean).join(path.delimiter);
  if (!env.COREPACK_ENABLE_DOWNLOAD_PROMPT) {
    env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  }
  return { env, targetNodePath };
}

/**
 * 使用与 exec 相同的 env 传入方式；此处用 spawn+shell 以便将 stdout/stderr 流式交给 SSE。
 * （若仅用 exec，整段输出仅在进程结束后一次性返回，无法满足实时日志。）
 */
function runShellStreaming(command, { cwd, env, onLog }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.on('data', (chunk) => onLog(chunk.toString()));
    child.stderr?.on('data', (chunk) => onLog(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`命令失败，退出码 ${code}: ${command}`));
    });
  });
}

function zipDirectory(sourceDir, outFile) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function emitStep(onStep, step, phase, extra = {}) {
  if (typeof onStep !== 'function') return;
  onStep({ step, phase, at: new Date().toISOString(), ...extra });
}

function emitBackup(onStep, phase, extra = {}) {
  if (typeof onStep !== 'function') return;
  onStep({ type: 'backup', phase, at: new Date().toISOString(), ...extra });
}

/**
 * 完整部署：克隆 → 安装 → 构建 → 推送（含压缩与 SSH）
 * @param {object} project
 * @param {(line: string) => void} onLog
 * @param {(ev: { step: string, phase: 'start'|'end', at: string }) => void} [onStep]
 */
export async function runDeploy(project, onLog, onStep, options = {}) {
  await cleanupStaleDeployWorkdirs();

  const { user, pwd } = getGitlabAuth();
  const authUrl = buildAuthenticatedGitUrl(project.gitUrl, user, pwd);
  const workBase = getDeployWorkRootBase();
  await mkdir(workBase, { recursive: true });
  const workRoot = path.join(workBase, `fe-deploy-${randomUUID()}`);
  const repoDir = path.join(workRoot, 'repo');
  const zipPath = path.join(workRoot, 'dist.zip');

  const log = (msg) => onLog(`[${new Date().toISOString()}] ${msg}`);

  log(`构建工作目录: ${workRoot}`);
  await mkdir(repoDir, { recursive: true });

  try {
    let backupPromise = null;
    if (options.backupBeforeBuild && !project.buildOnly) {
      emitBackup(onStep, 'start');
      log('已启用同步创建当前备份，备份任务开始执行');
      backupPromise = createProjectBackup(project)
        .then((backup) => {
          emitBackup(onStep, 'end', { filename: backup.filename });
          log(`当前文件备份完成: ${backup.filename}`);
          return backup;
        })
        .catch((e) => {
          emitBackup(onStep, 'error', { message: e.message });
          log(`[错误] 当前文件备份失败: ${e.message}`);
          throw e;
        });
    }

    emitStep(onStep, 'clone', 'start');
    log('开始克隆仓库…');
    const git = simpleGit();
    await git.clone(authUrl, repoDir, [
      '--branch',
      project.branch,
      '--single-branch',
      '--depth',
      '1',
    ]);

    log(
      `分析近 1 小时内提交成员（分支 ${project.branch}，用于敏捷遗漏核对）…`,
    );
    const recentCommitsSummary = await summarizeRecentCommitters(
      repoDir,
      project.branch,
      {
        hours: 1,
        onLog: log,
        deepen: 500,
      },
    );
    const { authors, sinceIso } = recentCommitsSummary;
    if (!authors?.length) {
      log(
        `[近1小时提交] 无记录或历史过浅（统计自 ${sinceIso}）。请确认他人已 push，或加深 fetch 是否成功。\n`,
      );
    } else {
      const line = authors
        .map((a) => `${a.name} <${a.email}> (${a.commitCount} 笔)`)
        .join('；');
      log(`[近1小时提交] 共 ${authors.length} 人：${line}\n`);
    }
    emitStep(onStep, 'clone', 'end', { recentCommitsSummary });

    const { env, targetNodePath } = createIsolatedNodeEnv(project.nodeVersion);
    log(`Node 隔离路径: ${targetNodePath}`);
    if (!(await pathExists(targetNodePath))) {
      throw new Error(`未找到 Node 目录: ${targetNodePath}，请确认 NVM 已安装该版本`);
    }

    const run = (cmd) =>
      runShellStreaming(cmd, {
        cwd: repoDir,
        env,
        onLog: (chunk) => onLog(chunk),
      });

    emitStep(onStep, 'install', 'start');
    log(`执行依赖安装: ${project.installCommand}`);
    await run(project.installCommand);
    emitStep(onStep, 'install', 'end');

    if (backupPromise) {
      log('打包前检查当前备份状态…');
      await backupPromise;
    }

    emitStep(onStep, 'build', 'start');
    log(`执行打包: ${project.buildCommand}`);
    await run(project.buildCommand);
    emitStep(onStep, 'build', 'end');

    const distDir = path.join(repoDir, 'dist');
    if (!(await pathExists(distDir))) {
      throw new Error(`打包后未找到 dist 目录: ${distDir}`);
    }

    log('压缩 dist…');
    await zipDirectory(distDir, zipPath);
    try {
      await saveLastDistZip(project.id, zipPath);
      log('已保存本次打包 zip，可在构建与发布弹窗中下载');
    } catch (e) {
      log(`[提示] 保存本地打包副本失败: ${e.message}`);
      if (project.buildOnly) {
        throw e;
      }
    }
    if (project.buildOnly) {
      log('打包完成');
      return;
    }

    emitStep(onStep, 'push', 'start');

    const ssh = new NodeSSH();
    log(`连接服务器 ${project.serverIp}…`);
    await ssh.connect({
      host: project.serverIp,
      username: project.serverUser,
      password: project.serverPassword,
      readyTimeout: 30000,
    });

    const remoteBase = project.serverPath.replace(/\/$/, '');
    const useSudoRoot = Boolean(project.sshSudoSuRoot);
    const switchPw = String(project.rootSwitchPassword ?? '').trim();
    if (useSudoRoot && !switchPw) {
      throw new Error(
        '已勾选「登录后切换 root 账号」，请在项目中配置「切换密码」',
      );
    }

    const exec = (cmd) =>
      execSshCommand(ssh, cmd, useSudoRoot ? project.rootSwitchPassword : null);

    if (useSudoRoot) {
      log('远程部署将使用 sudo 提权（切换密码通过 stdin 传入 sudo -S）…');
      const slug = String(project.id).replace(/-/g, '').slice(0, 12);
      const tmpZip = `/tmp/fe-deploy-${slug}.zip`;
      log(`准备远程目录: ${remoteBase}`);
      const prep = [
        `mkdir -p ${JSON.stringify(remoteBase)}`,
        `rm -rf ${JSON.stringify(remoteBase)}/*`,
      ].join(' && ');
      const prepRes = await exec(prep);
      if (prepRes.code !== 0) {
        throw new Error(
          `远程准备目录失败: ${prepRes.stderr || prepRes.stdout}`,
        );
      }
      log(`上传 ${zipPath} -> ${tmpZip}（临时文件，再由 root 部署至目标目录）`);
      await ssh.putFile(zipPath, tmpZip);
      log('远程解压（root）…');
      const innerCmd = [
        `cp ${JSON.stringify(tmpZip)} ${JSON.stringify(`${remoteBase}/dist.zip`)}`,
        `cd ${JSON.stringify(remoteBase)} && unzip -o dist.zip && rm -f dist.zip`,
        `rm -f ${JSON.stringify(tmpZip)}`,
      ].join(' && ');
      const unzip = await exec(innerCmd);
      if (unzip.code !== 0) {
        throw new Error(`远程解压失败: ${unzip.stderr || unzip.stdout}`);
      }
    } else {
      log(`准备远程目录: ${remoteBase}`);
      const mk = await exec(`mkdir -p "${remoteBase}"`);
      if (mk.code !== 0) {
        throw new Error(`创建远程目录失败: ${mk.stderr || mk.stdout}`);
      }
      const rmOld = await exec(`rm -rf "${remoteBase}"/*`);
      if (rmOld.code !== 0) {
        throw new Error(`清理远程目录失败: ${rmOld.stderr || rmOld.stdout}`);
      }
      const remoteZip = `${remoteBase}/dist.zip`;
      log(`上传 ${zipPath} -> ${remoteZip}`);
      await ssh.putFile(zipPath, remoteZip);
      log('远程解压…');
      const unzip = await exec(
        `cd "${remoteBase}" && unzip -o dist.zip && rm -f dist.zip`,
      );
      if (unzip.code !== 0) {
        throw new Error(`远程解压失败: ${unzip.stderr || unzip.stdout}`);
      }
    }
    emitStep(onStep, 'push', 'end');

    log('部署完成');
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
