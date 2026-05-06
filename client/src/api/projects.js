import axios from 'axios';
import { getAxiosBaseURL, resolveApiUrl } from './apiConfig.js';

const http = axios.create({
  baseURL: getAxiosBaseURL(),
  timeout: 120_000,
});

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg =
      err.response?.data?.message ||
      err.message ||
      '请求失败';
    return Promise.reject(new Error(msg));
  },
);

export function fetchProjects() {
  return http.get('/projects').then((r) => {
    const d = r.data;
    if (!Array.isArray(d)) {
      console.warn('[api] /projects 返回非数组，已忽略', d);
      return [];
    }
    return d.filter((p) => p && typeof p === 'object' && p.id);
  });
}

export function createProject(payload) {
  return http.post('/projects', payload).then((r) => r.data);
}

export function updateProject(id, payload) {
  return http.put(`/projects/${id}`, payload).then((r) => r.data);
}

export function deleteProject(id) {
  return http.delete(`/projects/${id}`);
}

/** 下载发布控制台保存的「上次成功发布」dist.zip */
export async function downloadLastDist(projectId) {
  const url = `${getAxiosBaseURL()}/projects/${projectId}/download-last-dist`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = '下载失败';
    try {
      const j = await res.json();
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const dispo = res.headers.get('Content-Disposition');
  let filename = 'last-dist.zip';
  const m = /filename\*=UTF-8''([^;\n]+)/i.exec(dispo || '');
  if (m) filename = decodeURIComponent(m[1]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 触发部署，返回 jobId，再通过 SSE 订阅日志
 */
export function startDeploy(projectId) {
  return http.post('/deploy', { projectId }).then((r) => r.data);
}

/**
 * SSE 须与 API 同源；分源部署时依赖 VITE_API_ORIGIN 拼出完整地址
 */
export function getDeployStreamUrl(jobId) {
  return resolveApiUrl(`/api/deploy/stream/${jobId}`);
}
