import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPort } from './config/env.js';
import projectsRouter from './routes/projects.js';
import deployRouter from './routes/deploy.js';
import logsRouter from './routes/logs.js';
import statsRouter from './routes/stats.js';
import { getDb } from './db/lowdb.js';
import { pruneOldDeployLogs } from './services/deployHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/projects', projectsRouter);
app.use('/api/deploy', deployRouter);
app.use('/api/logs', logsRouter);
app.use('/api/stats', statsRouter);

/** 前端 `npm run build` 产物目录（Vite outDir 指向此处） */
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || '服务器错误' });
});

const port = getPort();
await getDb();
await pruneOldDeployLogs().catch((e) => console.error('裁剪发布日志失败', e));

const server = app.listen(port);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `端口 ${port} 已被占用。请关闭占用该端口的进程，或在 .env 中设置 PORT=其他端口后再启动。`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.on('listening', () => {
  console.log(`内网发布服务已启动: http://localhost:${port}`);
  console.log('若已执行客户端 build，可直接访问上述地址使用发布控制台。');
});
