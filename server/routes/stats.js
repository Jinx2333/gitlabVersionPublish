import { Router } from 'express';
import { getDb } from '../db/lowdb.js';

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 近 7 日构建次数、成功率、按日柱状数据（供 System Health / Active Nodes）
 */
router.get('/summary', async (req, res, next) => {
  try {
    const db = await getDb();
    const logs = db.data.deployLogs ?? [];
    const now = Date.now();
    const todayStart = startOfDay(now);
    const sevenAgo = todayStart - 6 * DAY_MS;

    const recent = logs.filter((l) => {
      const t = new Date(l.finishedAt).getTime();
      return !Number.isNaN(t) && t >= sevenAgo && t < todayStart + DAY_MS;
    });

    const success = recent.filter((l) => l.status === 'success').length;
    const failed = recent.filter((l) => l.status === 'failed').length;
    const total = recent.length;
    const successRate =
      total > 0 ? Math.round((success / total) * 1000) / 10 : 100;

    const bars = [];
    for (let i = 0; i < 7; i += 1) {
      const dayStart = sevenAgo + i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const count = recent.filter((l) => {
        const t = new Date(l.finishedAt).getTime();
        return t >= dayStart && t < dayEnd;
      }).length;
      bars.push(count);
    }

    const maxBar = Math.max(...bars, 1);
    const barPercents = bars.map((c) =>
      Math.max(8, Math.round((c / maxBar) * 100)),
    );

    let healthLabel = 'Optimal';
    if (total === 0) healthLabel = '暂无数据';
    else if (successRate < 80) healthLabel = '需关注';
    else if (successRate < 95) healthLabel = '稳定';

    res.json({
      total7d: total,
      success7d: success,
      failed7d: failed,
      successRate,
      healthLabel,
      bars,
      barPercents,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
