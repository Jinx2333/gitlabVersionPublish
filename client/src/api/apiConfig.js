/**
 * 生产环境静态资源与 API 不同源时，在 client/.env.production 中设置：
 *   VITE_API_ORIGIN=http://后端主机:端口
 * （不要末尾斜杠；不要带 /api，脚本会自动拼 /api）
 */
function trimSlash(s) {
  return String(s ?? '').replace(/\/+$/, '');
}

export function getApiOrigin() {
  const raw = import.meta.env.VITE_API_ORIGIN;
  if (raw == null || String(raw).trim() === '') return '';
  return trimSlash(String(raw).trim());
}

/** axios 的 baseURL：同源时为 /api，分源时为 http://host:4000/api */
export function getAxiosBaseURL() {
  const origin = getApiOrigin();
  return origin ? `${origin}/api` : '/api';
}

/**
 * 浏览器请求的绝对或相对 URL（path 须以 / 开头，含 /api/...）
 */
export function resolveApiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const origin = getApiOrigin();
  return origin ? `${origin}${p}` : p;
}
