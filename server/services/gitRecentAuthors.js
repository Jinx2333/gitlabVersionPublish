import simpleGit from 'simple-git';

const UNIT = '\x1f';

/**
 * shallow clone 之后加深历史，统计指定分支近 N 小时内提交过代码的作者（不含 merge）
 * @param {string} repoDir
 * @param {string} branch
 * @param {{ hours?: number, onLog?: (s: string) => void, deepen?: number }} [opts]
 */
export async function summarizeRecentCommitters(repoDir, branch, opts = {}) {
  const hours = Number(opts.hours) > 0 ? Number(opts.hours) : 1;
  const deepen = Number(opts.deepen) > 0 ? Number(opts.deepen) : 500;
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};

  const git = simpleGit({ baseDir: repoDir });
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  try {
    await git.raw(['fetch', '--deepen', String(deepen)]);
  } catch (e) {
    onLog(
      `[提示] 加深克隆深度失败（仍可尝试统计当前可见提交）: ${e.message}\n`,
    );
  }

  let raw;
  try {
    raw = await git.raw([
      'log',
      'HEAD',
      `--since=${sinceIso}`,
      `--format=%H${UNIT}%an${UNIT}%ae${UNIT}%s`,
      '--no-merges',
    ]);
  } catch (e) {
    onLog(`[提示] git log 统计失败: ${e.message}\n`);
    return {
      branch,
      sinceIso,
      windowHours: hours,
      authors: [],
      error: e.message,
    };
  }

  const text = String(raw ?? '').trim();
  if (!text) {
    return {
      branch,
      sinceIso,
      windowHours: hours,
      authors: [],
    };
  }

  const lines = text.split('\n').filter(Boolean);
  const byEmail = new Map();

  for (const line of lines) {
    const parts = line.split(UNIT);
    const hash = parts[0];
    const name = parts[1] ?? '';
    const email = parts[2] ?? '';
    const subject = parts.slice(3).join(UNIT) || '';
    if (!hash || !email) continue;
    let ent = byEmail.get(email);
    if (!ent) {
      ent = { name: name || email, email, commits: [] };
      byEmail.set(email, ent);
    }
    ent.commits.push({
      hash: hash.slice(0, 12),
      subject: subject.slice(0, 200),
    });
  }

  const authors = [...byEmail.values()]
    .map((a) => ({
      name: a.name,
      email: a.email,
      commitCount: a.commits.length,
      commits: a.commits.slice(0, 10),
    }))
    .sort((x, y) => y.commitCount - x.commitCount);

  return {
    branch,
    sinceIso,
    windowHours: hours,
    authors,
  };
}
