import { randomUUID } from 'crypto';
import { getDb } from '../db/lowdb.js';
import { enqueueDbWrite } from '../db/writeQueue.js';
import { replayToPipeline } from './pipeline.js';

const MAX_LOGS = 2000;
const MAX_LOG_TEXT_CHARS = 250_000;
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function filterDeployLogsWithinRetention(logs, now = Date.now()) {
  const cutoff = now - LOG_RETENTION_MS;
  return (logs ?? []).filter((l) => {
    const t = new Date(l.finishedAt).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
}

/**
 * 启动或维护时裁剪日志（仅保留 finishedAt 在 7 天内）
 */
export function pruneOldDeployLogs() {
  return enqueueDbWrite(async () => {
    const db = await getDb();
    db.data.deployLogs = filterDeployLogsWithinRetention(db.data.deployLogs ?? []);
    await db.write();
  });
}

function trimLogText(text) {
  const t = String(text ?? '');
  if (t.length <= MAX_LOG_TEXT_CHARS) return t;
  return `…(已截断)\n${t.slice(-MAX_LOG_TEXT_CHARS)}`;
}

/**
 * 部署结束后更新项目状态并追加总日志（写入经队列串行化，互不阻塞其它部署任务）
 */
export function persistDeployOutcome({
  projectId,
  projectName,
  jobId,
  startedAt,
  finishedAt,
  success,
  errorMessage,
  logText,
  publisherIp,
  pipelineSteps,
  stepsReplay,
}) {
  return enqueueDbWrite(async () => {
    const db = await getDb();
    db.data.deployLogs ||= [];

    const steps =
      Array.isArray(pipelineSteps) && pipelineSteps.length
        ? pipelineSteps
        : replayToPipeline(stepsReplay ?? []);

    const entry = {
      id: randomUUID(),
      jobId: jobId ?? null,
      projectId,
      projectName,
      startedAt,
      finishedAt,
      status: success ? 'success' : 'failed',
      summary: success ? '发布成功' : (errorMessage || '发布失败'),
      logText: trimLogText(logText),
      publisherIp: publisherIp ?? null,
      pipelineSteps: steps,
    };
    db.data.deployLogs.unshift(entry);
    db.data.deployLogs = filterDeployLogsWithinRetention(db.data.deployLogs);
    if (db.data.deployLogs.length > MAX_LOGS) {
      db.data.deployLogs.length = MAX_LOGS;
    }

    const p = db.data.projects.find((x) => x.id === projectId);
    if (p) {
      p.lastDeployStatus = success ? 'success' : 'failed';
      p.lastDeployAt = finishedAt;
      p.lastDeployError = success ? null : (errorMessage || '未知错误');
      if (success) {
        p.lastSuccessAt = finishedAt;
      }
    }

    await db.write();
  });
}
