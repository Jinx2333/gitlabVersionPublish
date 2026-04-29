import axios from 'axios';
import { getAxiosBaseURL } from './apiConfig.js';

const http = axios.create({
  baseURL: getAxiosBaseURL(),
  timeout: 8000,
});

/** 探测后端 /api/health，成功且 { ok: true } 视为在线 */
export async function checkApiHealth() {
  try {
    const r = await http.get('/health');
    return r?.data?.ok === true;
  } catch {
    return false;
  }
}
