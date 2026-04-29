import { Router } from 'express';
import { getDb } from '../db/lowdb.js';

const router = Router();

/**
 * 总日志列表。query: projectId 可选, limit 默认 80
 */
router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const raw = db.data.deployLogs ?? [];
    let list = [...raw];
    const { projectId } = req.query;
    if (projectId) {
      list = list.filter((e) => e.projectId === projectId);
    }
    list.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    const limit = Math.min(Number(req.query.limit) || 80, 200);
    const slice = list.slice(0, limit).map((e) => ({
      id: e.id,
      jobId: e.jobId,
      projectId: e.projectId,
      projectName: e.projectName,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      status: e.status,
      summary: e.summary,
      publisherIp: e.publisherIp ?? null,
    }));
    res.json(slice);
  } catch (e) {
    next(e);
  }
});

/** 单条日志详情（含完整 logText） */
router.get('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const entry = (db.data.deployLogs ?? []).find((e) => e.id === req.params.id);
    if (!entry) {
      res.status(404).json({ message: '日志不存在' });
      return;
    }
    res.json(entry);
  } catch (e) {
    next(e);
  }
});

export default router;
