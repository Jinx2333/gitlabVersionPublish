/**
 * 判断是否为应持久化展示的项目记录（排除空壳/损坏项）
 */
export function isValidStoredProject(p) {
  if (!p || typeof p !== 'object') return false;
  if (!p.id) return false;
  const name = String(p.name ?? '').trim();
  const git = String(p.gitUrl ?? '').trim();
  if (!name && !git) return false;
  return true;
}
