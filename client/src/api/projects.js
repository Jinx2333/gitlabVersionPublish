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
