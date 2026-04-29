<script setup>
import {
  ref,
  computed,
  watch,
  reactive,
  onBeforeUnmount,
  nextTick,
} from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fetchDeployLogList } from '../api/logs.js';
import { startDeploy, getDeployStreamUrl } from '../api/projects.js';
import { formatDateTime, formatDuration } from '../utils/format.js';
import LogDetailDialog from './LogDetailDialog.vue';

const STEP_ORDER = ['clone', 'install', 'build', 'push'];

const STEP_META = {
  clone: { title: 'Clone', sub: '克隆仓库' },
  install: { title: 'Install', sub: '安装依赖' },
  build: { title: 'Build', sub: '构建打包' },
  push: { title: 'Push', sub: '推送上线' },
};

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  project: { type: Object, default: null },
});

const emit = defineEmits(['update:modelValue', 'deploy-ended']);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const mode = ref('history');
const historyRows = ref([]);
const historyLoading = ref(false);
const logText = ref('');
const logBox = ref(null);
const detailVisible = ref(false);
const selectedLogId = ref(null);

const timelineState = reactive({});

function initTimeline() {
  for (const id of STEP_ORDER) {
    timelineState[id] = {
      start: null,
      end: null,
      status: 'pending',
      __tick: 0,
    };
  }
}

let eventSource = null;
let streamEnded = false;

function teardownStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function resetDeployUi() {
  logText.value = '';
  streamEnded = false;
  initTimeline();
}

const isProjectBusy = computed(
  () => props.project?.runtimeBuild?.active === true,
);

async function loadHistory() {
  if (!props.project?.id) return;
  historyLoading.value = true;
  try {
    historyRows.value = await fetchDeployLogList({
      projectId: props.project.id,
      limit: 50,
    });
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    historyLoading.value = false;
  }
}

function applyStepEvent({ step, phase, at }) {
  if (!timelineState[step]) return;
  if (phase === 'start') {
    timelineState[step].start = at;
    timelineState[step].status = 'active';
  } else if (phase === 'end') {
    timelineState[step].end = at;
    timelineState[step].status = 'success';
  }
}

async function scrollLog() {
  await nextTick();
  const el = logBox.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function markActiveStepFailed() {
  STEP_ORDER.forEach((id) => {
    const s = timelineState[id];
    if (s.status === 'active') {
      s.status = 'error';
      if (!s.end) s.end = new Date().toISOString();
    }
  });
}

function finishSuccess() {
  if (streamEnded) return;
  streamEnded = true;
  teardownStream();
  emit('deploy-ended', { ok: true });
  ElMessage.success('发布完成');
  window.setTimeout(async () => {
    mode.value = 'history';
    await loadHistory();
  }, 400);
}

function finishFailure(msg) {
  if (streamEnded) return;
  streamEnded = true;
  markActiveStepFailed();
  teardownStream();
  emit('deploy-ended', { ok: false });
  if (msg) ElMessage.error(msg);
  window.setTimeout(async () => {
    mode.value = 'history';
    await loadHistory();
  }, 400);
}

function attachStreamHandlers() {
  if (!eventSource) return;

  eventSource.addEventListener('step', (ev) => {
    try {
      applyStepEvent(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  });

  eventSource.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      const line = payload.line ?? '';
      logText.value += line;
      scrollLog();
      if (line.includes('部署完成')) {
        finishSuccess();
      }
      if (line.includes('[错误]') || line.includes('命令失败')) {
        finishFailure();
      }
    } catch {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      logText.value += raw;
      scrollLog();
    }
  };

  eventSource.onerror = () => {
    if (streamEnded) return;
    if (mode.value !== 'deploying') return;
    if (logText.value.includes('部署完成')) {
      finishSuccess();
      return;
    }
    finishFailure('日志连接中断');
  };
}

function connectStream(jobId) {
  teardownStream();
  const url = getDeployStreamUrl(jobId);
  eventSource = new EventSource(url);
  attachStreamHandlers();
}

async function onDeployClick() {
  if (!props.project?.id) return;
  if (isProjectBusy.value) {
    ElMessage.warning('该项目正在构建中，请等待完成或失败');
    return;
  }
  mode.value = 'deploying';
  resetDeployUi();
  let jobId;
  try {
    const data = await startDeploy(props.project.id);
    jobId = data.jobId;
  } catch (e) {
    ElMessage.error(e.message || '启动失败');
    mode.value = 'history';
    return;
  }
  connectStream(jobId);
}

function openDetail(row) {
  selectedLogId.value = row.id;
  detailVisible.value = true;
}

function statusTagType(s) {
  if (s === 'success') return 'success';
  if (s === 'failed') return 'danger';
  return 'info';
}

function stepDotClass(id) {
  const s = timelineState[id];
  if (s.status === 'error') return 'is-error';
  if (s.status === 'active') return 'is-active';
  if (s.status === 'success') return 'is-done';
  return 'is-wait';
}

function stepDurationText(id) {
  const s = timelineState[id];
  if (!s?.start) return '等待中';
  if (!s?.end) {
    const ms = Date.now() - new Date(s.start).getTime();
    return `进行中 · ${formatDuration(ms)}`;
  }
  return formatDuration(new Date(s.end) - new Date(s.start));
}

function stepRangeText(id) {
  const s = timelineState[id];
  if (!s?.start) return '—';
  const a = formatDateTime(s.start);
  const b = s.end ? formatDateTime(s.end) : '进行中';
  return `${a} → ${b}`;
}

let tickTimer = null;
function startTick() {
  stopTick();
  tickTimer = window.setInterval(() => {
    STEP_ORDER.forEach((id) => {
      if (timelineState[id].status === 'active') {
        timelineState[id].__tick += 1;
      }
    });
  }, 500);
}
function stopTick() {
  if (tickTimer) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

watch(
  () => mode.value,
  (m) => {
    if (m === 'deploying') startTick();
    else stopTick();
  },
);

watch(
  () => [props.modelValue, props.project?.id],
  async ([open, projectId]) => {
    if (!open) {
      teardownStream();
      stopTick();
      mode.value = 'history';
      return;
    }
    if (!projectId) return;
    resetDeployUi();
    await loadHistory();
    const rt = props.project?.runtimeBuild;
    if (rt?.active && rt.jobId) {
      mode.value = 'deploying';
      connectStream(rt.jobId);
    } else {
      mode.value = 'history';
    }
  },
);

function handleClose(done) {
  if (mode.value === 'deploying') {
    ElMessageBox.confirm(
      '构建尚未结束，关闭后可在列表查看状态；确定关闭窗口？',
      '提示',
      {
        type: 'warning',
        confirmButtonText: '仍要关闭',
        cancelButtonText: '取消',
      },
    )
      .then(() => {
        teardownStream();
        done();
      })
      .catch(() => {});
    return;
  }
  done();
}

onBeforeUnmount(() => {
  teardownStream();
  stopTick();
});
</script>

<template>
  <el-dialog
    v-model="visible"
    class="build-dialog"
    width="920px"
    top="5vh"
    destroy-on-close
    :close-on-click-modal="false"
    :before-close="handleClose"
  >
    <template #header>
      <div class="dlg-head">
        <div class="dlg-head-text">
          <div class="dlg-title">构建与发布</div>
          <div class="dlg-sub">
            {{ project?.name || '—' }}
            <span v-if="isProjectBusy" class="busy-pill">构建进行中</span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="mode === 'history'" class="panel history-panel">
      <div class="panel-intro">
        <div class="intro-icon">📦</div>
        <div>
          <div class="intro-title">发布记录</div>
          <div class="intro-desc">
            以下为该项目历史发布记录（含发布来源 IP）。点击下方「开始发布」进入流水线。
          </div>
        </div>
      </div>

      <el-table
        v-loading="historyLoading"
        :data="historyRows"
        stripe
        border
        class="hist-table"
        max-height="320"
        empty-text="暂无发布记录"
        @row-dblclick="openDetail"
      >
        <el-table-column
          label="结束时间"
          width="168"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ formatDateTime(row.finishedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="86" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="publisherIp"
          label="发布 IP"
          width="130"
          show-overflow-tooltip
        />
        <el-table-column
          prop="summary"
          label="摘要"
          min-width="140"
          show-overflow-tooltip
        />
        <el-table-column label="操作" width="88" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="footer-actions">
        <el-button
          type="success"
          size="large"
          :disabled="isProjectBusy"
          @click="onDeployClick"
        >
          {{ isProjectBusy ? '构建进行中…' : '开始发布' }}
        </el-button>
      </div>
    </div>

    <div v-else class="panel deploy-panel">
      <div class="deploy-split">
        <aside class="timeline-aside">
          <div class="aside-title">流水线</div>
          <div class="timeline-track">
            <div
              v-for="id in STEP_ORDER"
              :key="id"
              class="t-node"
            >
              <div class="t-dot-wrap">
                <span class="t-dot" :class="stepDotClass(id)" />
                <span
                  v-if="id !== STEP_ORDER[STEP_ORDER.length - 1]"
                  class="t-line"
                  :class="{
                    'is-done':
                      timelineState[id].status === 'success' ||
                      timelineState[id].status === 'error',
                  }"
                />
              </div>
              <div class="t-body">
                <div class="t-head">
                  <span class="t-name">{{ STEP_META[id].title }}</span>
                  <span class="t-sub">{{ STEP_META[id].sub }}</span>
                </div>
                <div class="t-range">{{ stepRangeText(id) }}</div>
                <div class="t-dur">
                  耗时：
                  <span :key="timelineState[id].__tick">{{ stepDurationText(id) }}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section class="log-section">
          <div class="log-head">
            <span>实时日志</span>
            <span class="log-hint">clone → install → build → push</span>
          </div>
          <div ref="logBox" class="log-terminal">
            <pre class="log-pre">{{ logText }}<span v-if="!streamEnded" class="cursor">▌</span></pre>
          </div>
        </section>
      </div>
    </div>

    <LogDetailDialog v-model="detailVisible" :log-id="selectedLogId" />
  </el-dialog>
</template>

<style scoped>
.build-dialog :deep(.el-dialog__header) {
  margin: 0;
  padding: 0;
}

.build-dialog :deep(.el-dialog) {
  margin-top: 5vh !important;
}

.build-dialog :deep(.el-dialog__body) {
  padding: 0 0 16px;
  overflow: hidden;
}

.dlg-head {
  padding: 18px 20px 12px;
  background: linear-gradient(120deg, #1d4ed8 0%, #0ea5e9 50%, #6366f1 100%);
  color: #fff;
  border-radius: 8px 8px 0 0;
}

.dlg-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.dlg-sub {
  margin-top: 6px;
  font-size: 13px;
  opacity: 0.95;
  display: flex;
  align-items: center;
  gap: 10px;
}

.busy-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.panel {
  padding: 16px 20px 0;
  min-height: 500px;
  box-sizing: border-box;
}

.history-panel .panel-intro {
  display: flex;
  gap: 14px;
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #e2e8f0;
}

.intro-icon {
  font-size: 28px;
  line-height: 1;
}

.intro-title {
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 4px;
}

.intro-desc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.hist-table {
  border-radius: 8px;
  overflow: hidden;
}

.footer-actions {
  display: flex;
  justify-content: center;
  padding: 18px 0 4px;
}

.deploy-split {
  display: flex;
  gap: 16px;
  height: 432px;
  align-items: stretch;
}

.timeline-aside {
  width: 260px;
  flex-shrink: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #1e293b;
  overflow-y: auto;
  overflow-x: hidden;
}

.aside-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
  margin-bottom: 12px;
}

.timeline-track {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.t-node {
  display: flex;
  gap: 10px;
}

.t-dot-wrap {
  width: 18px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.t-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #334155;
  box-shadow: 0 0 0 3px rgba(51, 65, 85, 0.35);
}

.t-dot.is-wait {
  background: #475569;
}

.t-dot.is-active {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.35);
  animation: pulse 1.2s ease-in-out infinite;
}

.t-dot.is-done {
  background: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25);
}

.t-dot.is-error {
  background: #f87171;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.35);
}

.t-line {
  width: 2px;
  flex: 1;
  min-height: 28px;
  margin: 4px 0;
  background: #334155;
  border-radius: 1px;
}

.t-line.is-done {
  background: linear-gradient(180deg, #38bdf8, #22c55e);
}

.t-body {
  flex: 1;
  padding-bottom: 14px;
}

.t-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.t-name {
  font-weight: 700;
  font-size: 14px;
  color: #f8fafc;
}

.t-sub {
  font-size: 12px;
  color: #94a3b8;
}

.t-range {
  margin-top: 4px;
  font-size: 11px;
  color: #cbd5e1;
  font-family: ui-monospace, Consolas, monospace;
}

.t-dur {
  margin-top: 2px;
  font-size: 11px;
  color: #a5b4fc;
}

.log-section {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.log-hint {
  font-size: 12px;
  font-weight: 400;
  color: #64748b;
}

.log-terminal {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
  background: #0b1220;
  padding: 12px;
}

.log-pre {
  margin: 0;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.cursor {
  color: #4ade80;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.85;
  }
}
</style>
