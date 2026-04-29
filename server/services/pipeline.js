const ORDER = ['clone', 'install', 'build', 'push'];

const LABELS = {
  clone: '克隆仓库',
  install: '安装依赖',
  build: '构建打包',
  push: '推送上线',
};

/**
 * 将 SSE 步骤回放转成可持久化 / 展示的流水线
 * @param {Array<{ step: string, phase: string, at: string }>} replay
 */
export function replayToPipeline(replay) {
  if (!Array.isArray(replay) || replay.length === 0) {
    return ORDER.map((id) => ({
      id,
      label: LABELS[id],
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    }));
  }
  const times = {};
  for (const ev of replay) {
    const { step, phase, at } = ev;
    if (!ORDER.includes(step) || !['start', 'end'].includes(phase)) continue;
    if (!times[step]) times[step] = {};
    times[step][phase] = at;
  }
  return ORDER.map((id) => {
    const t = times[id] || {};
    let durationMs = null;
    if (t.start && t.end) {
      durationMs = new Date(t.end) - new Date(t.start);
    }
    return {
      id,
      label: LABELS[id],
      startedAt: t.start ?? null,
      finishedAt: t.end ?? null,
      durationMs,
    };
  });
}
