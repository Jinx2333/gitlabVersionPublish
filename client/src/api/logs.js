import axios from 'axios';
import { getAxiosBaseURL } from './apiConfig.js';

const http = axios.create({
  baseURL: getAxiosBaseURL(),
  timeout: 60_000,
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

export function fetchDeployLogList({ projectId, limit = 80 } = {}) {
  const params = { limit };
  if (projectId) {
    params.projectId = projectId;
  }
  return http.get('/logs', { params }).then((r) => r.data);
}

export function fetchLogDetail(id) {
  return http.get(`/logs/${id}`).then((r) => r.data);
}
