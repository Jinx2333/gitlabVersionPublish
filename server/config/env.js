import dotenv from 'dotenv';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 与 PM2 cwd 无关，固定从仓库根目录加载 .env */
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

/**
 * 从 process.env 读取并校验 GitLab / NVM 相关配置（规范要求）
 */
export function getGitlabAuth() {
  const user = process.env.GITLAB_USER;
  const pwd = process.env.GITLAB_PWD;
  if (!user || !pwd) {
    throw new Error('请在 .env 中配置 GITLAB_USER 与 GITLAB_PWD');
  }
  return { user, pwd };
}

export function getNvmHome() {
  const nvmHome = process.env.NVM_HOME;
  if (!nvmHome) {
    throw new Error('请在 .env 中配置 NVM_HOME（Windows 下 NVM 根目录）');
  }
  return nvmHome;
}

export function getPort() {
  const p = Number(process.env.PORT);
  return Number.isFinite(p) && p > 0 ? p : 4000;
}

/**
 * 部署时克隆/构建的工作目录父路径。
 * Windows 默认用「盘符:\fe-deploy-work」，避免用户 Temp 下长路径、8.3 短路径混用触发 Vite/Rollup 对 index.html 路径异常。
 * 可通过 FE_DEPLOY_WORK_ROOT 覆盖（例如 D:\build\fe-deploy）。
 */
export function getDeployWorkRootBase() {
  const raw = process.env.FE_DEPLOY_WORK_ROOT;
  if (raw != null && String(raw).trim() !== '') {
    return resolve(String(raw).trim());
  }
  if (process.platform === 'win32') {
    const drive = process.env.SystemDrive || 'C:';
    return join(drive, 'fe-deploy-work');
  }
  return os.tmpdir();
}
