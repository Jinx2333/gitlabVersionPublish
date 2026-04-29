import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/lowdb.js';
import { isValidStoredProject } from '../db/projectHelpers.js';
import { getRuntimeBuild } from '../state/activeDeploy.js';

const router = Router();

/**
 * 项目字段：id, name, gitUrl, branch, nodeVersion, installCommand, buildCommand,
 * serverIp, serverUser, serverPassword, serverPath, remark, loginUrl（可选）,
 * bizCategory: 煤矿 | 非煤 | other
 */
const BIZ_CATEGORIES = new Set(['煤矿', '非煤', 'other']);

function normalizeBizCategory(raw) {
  const s = String(raw ?? 'other').trim();
  return BIZ_CATEGORIES.has(s) ? s : 'other';
}
router.get('/', async (_req, res, next) => {
  try {
    const db = await getDb();
    const list = db.data.projects.filter(isValidStoredProject).map((p) => {
      const rt = getRuntimeBuild(p.id);
      return {
        ...p,
        runtimeBuild: rt
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
            },
      };
    });
    res.json(list);
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
    res.status(201).json(project);
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
    const prev = db.data.projects[idx];
    const nextProject = {
      ...prev,
      ...body,
      id: prev.id,
    };
    db.data.projects[idx] = nextProject;
    await db.write();
    res.json(nextProject);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const before = db.data.projects.length;
    db.data.projects = db.data.projects.filter((p) => p.id !== req.params.id);
    await db.write();
    if (db.data.projects.length === before) {
      res.status(404).json({ message: '项目不存在' });
      return;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
