import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/lowdb.js';
import { runDeploy } from '../services/deployService.js';
import { persistDeployOutcome } from '../services/deployHistory.js';
import { replayToPipeline } from '../services/pipeline.js';
import {
  tryBeginDeploy,
  setDeployStep,
  endDeploy,
} from '../state/activeDeploy.js';

const router = Router();

/** @type {Map<string, { subscribers: Set, logs: string[], stepListeners: Set<(p: object) => void>, stepsReplay: object[] }>} */
const jobs = new Map();

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  const raw = req.socket?.remoteAddress || req.ip || '';
  if (raw === '::1' || raw === '::ffff:127.0.0.1') return '127.0.0.1';
  return raw;
}

function appendLog(jobId, chunk) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.logs.push(chunk);
  for (const fn of job.subscribers) {
    try {
      fn(chunk);
    } catch {
      /* ignore */
    }
  }
}

function appendStep(jobId, payload) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.stepsReplay.push(payload);
  for (const fn of job.stepListeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

router.post('/', async (req, res, next) => {
  try {
    const projectId = req.body?.projectId;
    if (!projectId) {
      res.status(400).json({ message: '缺少 projectId' });
      return;
    }
    const db = await getDb();
    const project = db.data.projects.find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ message: '项目不存在' });
      return;
    }

    const jobId = randomUUID();
    const startedAt = new Date().toISOString();
    const publisherIp = getClientIp(req);

    const registered = tryBeginDeploy(projectId, {
      jobId,
      step: 'clone',
      startedAt,
    });
    if (!registered) {
      res.status(409).json({
        message: '该项目正在构建中，请等待完成或失败后再发布',
      });
      return;
    }

    jobs.set(jobId, {
      subscribers: new Set(),
      logs: [],
      stepListeners: new Set(),
      stepsReplay: [],
    });

    res.status(202).json({ jobId });

    const projectSnapshot = { ...project };

    const log = (line) => appendLog(jobId, line);

    const onStep = ({ step, phase, at }) => {
      appendStep(jobId, { step, phase, at });
      if (phase === 'start') {
        setDeployStep(projectId, step);
      }
    };

    runDeploy(projectSnapshot, log, onStep).then(
      async () => {
        const finishedAt = new Date().toISOString();
        const job = jobs.get(jobId);
        const logText = job ? job.logs.join('') : '';
        const stepsReplay = job ? [...job.stepsReplay] : [];
        try {
          await persistDeployOutcome({
            projectId: projectSnapshot.id,
            projectName: projectSnapshot.name,
            jobId,
            startedAt,
            finishedAt,
            success: true,
            errorMessage: null,
            logText,
            publisherIp,
            pipelineSteps: replayToPipeline(stepsReplay),
          });
        } catch (e) {
          console.error('持久化部署结果失败', e);
        }
      },
      async (err) => {
        log(`\n[错误] ${err.message}\n`);
        const finishedAt = new Date().toISOString();
        const job = jobs.get(jobId);
        const logText = job ? job.logs.join('') : '';
        const stepsReplay = job ? [...job.stepsReplay] : [];
        try {
          await persistDeployOutcome({
            projectId: projectSnapshot.id,
            projectName: projectSnapshot.name,
            jobId,
            startedAt,
            finishedAt,
            success: false,
            errorMessage: err.message,
            logText,
            publisherIp,
            pipelineSteps: replayToPipeline(stepsReplay),
          });
        } catch (e) {
          console.error('持久化部署结果失败', e);
        }
      },
    ).finally(() => {
      endDeploy(projectSnapshot.id);
      setTimeout(() => jobs.delete(jobId), 5 * 60_000);
    });
  } catch (e) {
    next(e);
  }
});

router.get('/stream/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ message: '任务不存在或已过期' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const sendLog = (data) => {
    res.write(`data: ${JSON.stringify({ line: data })}\n\n`);
  };

  for (const line of job.logs) {
    sendLog(line);
  }

  const onChunk = (chunk) => sendLog(chunk);
  job.subscribers.add(onChunk);

  const sendStep = (payload) => {
    res.write(`event: step\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  for (const p of job.stepsReplay) {
    sendStep(p);
  }

  const onStep = (payload) => sendStep(payload);
  job.stepListeners.add(onStep);

  req.on('close', () => {
    job.subscribers.delete(onChunk);
    job.stepListeners.delete(onStep);
  });
});

export default router;
