import axios from 'axios';
import { getAxiosBaseURL } from './apiConfig.js';

const http = axios.create({
  baseURL: getAxiosBaseURL(),
  timeout: 30_000,
});

http.interceptors.response.use(
  (r) => r,
  (err) =>
    Promise.reject(
      new Error(
        err.response?.data?.message || err.message || '请求失败',
      ),
    ),
);

export function fetchStatsSummary() {
  return http.get('/stats/summary').then((r) => r.data);
}
