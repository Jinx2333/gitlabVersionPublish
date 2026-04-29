/** 内存态：每个项目同时仅允许一条进行中的发布任务 */

const activeByProject = new Map();

/**
 * @param {string} projectId
 * @param {{ jobId: string, step: string, startedAt: string }} meta
 * @returns {boolean} 是否成功占用（false 表示已有进行中的发布）
 */
export function tryBeginDeploy(projectId, meta) {
  if (activeByProject.has(projectId)) {
    return false;
  }
  activeByProject.set(projectId, { ...meta });
  return true;
}

export function setDeployStep(projectId, step) {
  const cur = activeByProject.get(projectId);
  if (cur) {
    cur.step = step;
  }
}

export function endDeploy(projectId) {
  activeByProject.delete(projectId);
}

export function getRuntimeBuild(projectId) {
  return activeByProject.get(projectId) ?? null;
}
