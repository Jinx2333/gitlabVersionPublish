import { Router } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { createReadStream, existsSync } from 'fs';
import { rm } from 'fs/promises';
import { getDb, DB_DATA_DIR } from '../db/lowdb.js';
import { isValidStoredProject } from '../db/projectHelpers.js';
import { getRuntimeBuild } from '../state/activeDeploy.js';
import { getLastDistZipPath } from '../services/projectArtifacts.js';

const router = Router();

function toClientProject(p, runtimeBuild) {
  const { serverPassword: _sp, rootSwitchPassword: _rp, ...rest } = p;
  const hasLastDistArtifact = existsSync(getLastDistZipPath(p.id));
  return {
    ...rest,
    hasLastDistArtifact,
    runtimeBuild,
  };
}

/**
 * 项目字段：id, name, gitUrl, branch, nodeVersion, installCommand, buildCommand,
 * serverIp, serverUser, serverPassword, sshSudoSuRoot, rootSwitchPassword（仅服务端存，不下发）,
 * serverPath, remark, loginUrl（可选）,
 * bizCategory: 煤矿 | 非煤 | other
 */
const BIZ_CATEGORIES = new Set(['煤矿', '非煤', 'other']);

function normalizeBizCategory(raw) {
  const s = String(raw ?? 'other').trim();
  return BIZ_CATEGORIES.has(s) ? s : 'other';
}

function parseBool01(v) {
  return v === true || v === 'true' || v === 1;
}
router.get('/', async (_req, res, next) => {
  try {
    const db = await getDb();
    const list = db.data.projects.filter(isValidStoredProject).map((p) => {
      const rt = getRuntimeBuild(p.id);
      const runtimeBuild = rt
        ? {
            active: true,
            step: rt.step,
            startedAt: rt.startedAt,
            jobId: rt.jobId,
          }
        : {
            active: false,
            step: null,
            startedAt: null,
            jobId: null,
          };
      return toClientProject(p, runtimeBuild);
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/download-last-dist', async (req, res, next) => {
  try {
    const db = await getDb();
    const p = db.data.projects.find((x) => x.id === req.params.id);
    if (!p) {
      res.status(404).json({ message: '项目不存在' });
      return;
    }
    const zipPath = getLastDistZipPath(p.id);
    if (!existsSync(zipPath)) {
      res.status(404).json({ message: '暂无已保存的上次打包文件，请先成功发布一次' });
      return;
    }
    const rawName = String(p.name || 'dist').replace(/[\\/:*?"<>|]+/g, '_');
    const filename = `${rawName}-last-dist.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    createReadStream(zipPath).pipe(res);
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const body = req.body ?? {};
    const project = {
      id: randomUUID(),
      name: String(body.name ?? ''),
      gitUrl: String(body.gitUrl ?? ''),
      branch: String(body.branch ?? 'main'),
      nodeVersion: String(body.nodeVersion ?? ''),
      installCommand: String(body.installCommand ?? 'npm ci'),
      buildCommand: String(body.buildCommand ?? 'npm run build'),
      serverIp: String(body.serverIp ?? ''),
      serverUser: String(body.serverUser ?? ''),
      serverPassword: String(body.serverPassword ?? ''),
      sshSudoSuRoot: parseBool01(body.sshSudoSuRoot),
      rootSwitchPassword: parseBool01(body.sshSudoSuRoot)
        ? String(body.rootSwitchPassword ?? '')
        : '',
      serverPath: String(body.serverPath ?? ''),
      remark: String(body.remark ?? ''),
      loginUrl: String(body.loginUrl ?? ''),
      bizCategory: normalizeBizCategory(body.bizCategory),
      lastSuccessAt: null,
      lastDeployStatus: null,
      lastDeployAt: null,
      lastDeployError: null,
    };
    db.data.projects.push(project);
    await db.write();
    res.status(201).json({
      ...toClientProject(project, {
        active: false,
        step: null,
        startedAt: null,
        jobId: null,
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const idx = db.data.projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ message: '项目不存在' });
      return;
    }
    const body = { ...(req.body ?? {}) };
    for (const k of [
      'lastSuccessAt',
      'lastDeployStatus',
      'lastDeployAt',
      'lastDeployError',
      'runtimeBuild',
    ]) {
      delete body[k];
    }
    if (body.bizCategory != null) {
      body.bizCategory = normalizeBizCategory(body.bizCategory);
    }
    if (body.sshSudoSuRoot !== undefined) {
      body.sshSudoSuRoot = parseBool01(body.sshSudoSuRoot);
    }
    const pwdIn = String(body.serverPassword ?? '').trim();
    if (!pwdIn) {
      delete body.serverPassword;
    }
    if (body.sshSudoSuRoot === false) {
      body.rootSwitchPassword = '';
    } else {
      const rootIn = String(body.rootSwitchPassword ?? '').trim();
      if (!rootIn) {
        delete body.rootSwitchPassword;
      }
    }
    const prev = db.data.projects[idx];
    const nextProject = {
      ...prev,
      ...body,
      id: prev.id,
    };
    db.data.projects[idx] = nextProject;
    await db.write();
    const rt = getRuntimeBuild(prev.id);
    const runtimeBuild = rt
      ? {
          active: true,
          step: rt.step,
          startedAt: rt.startedAt,
          jobId: rt.jobId,
        }
      : {
          active: false,
          step: null,
          startedAt: null,
          jobId: null,
        };
    res.json(toClientProject(nextProject, runtimeBuild));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const id = req.params.id;
    const idx = db.data.projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ message: '项目不存在' });
      return;
    }
    db.data.projects.splice(idx, 1);
    await db.write();
    const artDir = path.join(DB_DATA_DIR, 'artifacts', id);
    await rm(artDir, { recursive: true, force: true }).catch(() => {});
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
