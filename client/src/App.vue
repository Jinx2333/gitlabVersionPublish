<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import ReleaseConsoleBackground from './components/ReleaseConsoleBackground.vue';
import ProjectFormDialog from './components/ProjectFormDialog.vue';
import ProjectBuildDialog from './components/ProjectBuildDialog.vue';
import DeployHistoryDrawer from './components/DeployHistoryDrawer.vue';
import { fetchProjects, deleteProject } from './api/projects.js';
import { fetchStatsSummary } from './api/stats.js';
import { checkApiHealth } from './api/health.js';
import { formatDateTime } from './utils/format.js';
import {
  BIZ_CATEGORY_OPTIONS,
  DEFAULT_BIZ_CATEGORY,
} from './constants/bizCategories.js';

const projects = ref([]);
/** 接口若返回非数组（旧包、网关误配等），仍按数组处理，避免 .some/.filter 报错 */
const projectList = computed(() =>
  Array.isArray(projects.value) ? projects.value : [],
);
const loading = ref(false);

/** 后端 API 连通：null 未探测，true 在线，false 离线 */
const apiReachable = ref(null);

const stats = ref({
  total7d: 0,
  success7d: 0,
  failed7d: 0,
  successRate: 100,
  healthLabel: '暂无数据',
  barPercents: [20, 35, 25, 40, 30, 45, 35],
});

const formVisible = ref(false);
const editingProject = ref(null);

const buildVisible = ref(false);
const buildProjectId = ref(null);
const buildProject = computed(
  () =>
    projectList.value.find((p) => p.id === buildProjectId.value) ?? null,
);

const historyVisible = ref(false);
const historyProjectId = ref(null);
const historyProjectName = ref('');

const filterOpen = ref(false);
const nameQuery = ref('');

/** 列表分类：全部 | 煤矿 | 非煤 | other */
const bizTab = ref('all');

const bizTabItems = [
  { value: 'all', label: '全部' },
  ...BIZ_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })),
];

const filteredProjects = computed(() => {
  let list = projectList.value;
  if (bizTab.value !== 'all') {
    list = list.filter(
      (p) => (p.bizCategory ?? DEFAULT_BIZ_CATEGORY) === bizTab.value,
    );
  }
  const q = nameQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) =>
    String(p.name ?? '')
      .toLowerCase()
      .includes(q),
  );
});

const listFiltered = computed(
  () => Boolean(nameQuery.value.trim()) || bizTab.value !== 'all',
);

let pollTimer = null;
let healthTimer = null;

async function pingApiHealth() {
  apiReachable.value = await checkApiHealth();
}

function clearHealthPoll() {
  if (healthTimer) {
    window.clearInterval(healthTimer);
    healthTimer = null;
  }
}

function clearPoll() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(
  () => projectList.value.some((p) => p.runtimeBuild?.active),
  (busy) => {
    clearPoll();
    if (busy) {
      pollTimer = window.setInterval(() => {
        loadProjects({ kind: 'silent' });
        loadStats();
      }, 2500);
    }
  },
);

function rowStatus(row) {
  if (row.runtimeBuild?.active) return 'building';
  if (row.lastDeployStatus === 'success') return 'success';
  if (row.lastDeployStatus === 'failed') return 'failed';
  return 'idle';
}

async function loadStats() {
  try {
    const s = await fetchStatsSummary();
    stats.value = { ...stats.value, ...s };
  } catch {
    /* ignore */
  }
}

async function loadProjects(payload) {
  const kind = payload?.kind;
  const silent = kind === 'silent';
  if (!silent) {
    loading.value = true;
  }
  try {
    try {
      const raw = await fetchProjects();
      projects.value = Array.isArray(raw) ? raw : [];
    } catch (e) {
      projects.value = [];
      if (!silent) {
        ElMessage.error(e.message || '加载失败');
      }
    }
    try {
      await loadStats();
    } catch {
      /* 统计失败不影响项目列表 */
    }
    await pingApiHealth();
  } finally {
    if (!silent) {
      loading.value = false;
    }
  }
}

function onDeployEnded() {
  window.setTimeout(() => {
    loadProjects({ kind: 'silent' });
    loadStats();
  }, 300);
}

function openGlobalHistory() {
  historyProjectId.value = null;
  historyProjectName.value = '';
  historyVisible.value = true;
}

function toggleFilters() {
  filterOpen.value = !filterOpen.value;
  if (!filterOpen.value) {
    nameQuery.value = '';
  }
}

async function openBuild(row) {
  await loadProjects({ kind: 'silent' });
  buildProjectId.value = row.id;
  buildVisible.value = true;
}

function openAdd() {
  editingProject.value = null;
  formVisible.value = true;
}

function openEdit(row) {
  editingProject.value = { ...row };
  formVisible.value = true;
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除项目「${row.name}」？此操作不可恢复。`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }
  try {
    await deleteProject(row.id);
    ElMessage.success('已删除');
    await loadProjects();
  } catch (e) {
    ElMessage.error(e.message || '删除失败');
  }
}

function syncLogs() {
  openGlobalHistory();
  loadProjects({ kind: 'silent' });
}

/** 打开配置的登录页（新标签）；无协议时补全 http:// */
function openLoginPage(row) {
  let u = String(row?.loginUrl ?? '').trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  window.open(u, '_blank', 'noopener,noreferrer');
}

onMounted(() => {
  pingApiHealth();
  healthTimer = window.setInterval(pingApiHealth, 20_000);
  loadProjects();
});

onUnmounted(() => {
  clearPoll();
  clearHealthPoll();
});
</script>

<template>
  <div class="release-app">
    <ReleaseConsoleBackground />

    <div class="rel-shell">
      <header class="top-header">
        <div class="brand-block">
          <div class="logo-tile" aria-hidden="true">
            <svg
              class="logo-rocket"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"
              />
              <path
                d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"
              />
            </svg>
          </div>
          <div>
            <h1 class="main-title">
              应急  <span class="text-cyan">WEB 发布控制台</span>
            </h1>
            <p class="main-sub">
              应急 WEB 发布控制台
            </p>
          </div>
        </div>

        <div class="top-actions">
          <button type="button" class="btn-ghost" @click="openGlobalHistory">
            发布总日志
          </button>
          <div
            class="status-dot-wrap"
            :class="{
              'is-online': apiReachable === true,
              'is-offline': apiReachable === false,
              'is-unknown': apiReachable === null,
            }"
            :title="
              apiReachable === true
                ? '后端 API 已连接'
                : apiReachable === false
                  ? '无法连接后端 API'
                  : '正在检测后端…'
            "
            role="status"
            :aria-label="
              apiReachable === true
                ? '后端已连接'
                : apiReachable === false
                  ? '后端未连接'
                  : '检测中'
            "
          >
            <span class="status-dot" />
          </div>
        </div>
      </header>

      <div class="main-grid">
        <aside class="sidebar">
          <div class="glass-card health-card">
            <div class="card-head-row">
              <span class="card-kicker">健康度</span>
              <span class="health-pct">{{ stats.successRate }}%</span>
            </div>
            <div class="health-body">
              <div class="health-label">
              状态统计
              </div>
              <div class="health-bar-track">
                <div
                  class="health-bar-fill"
                  :style="{ width: `${Math.min(100, stats.successRate)}%` }"
                />
              </div>
              <p class="health-meta">
                近7日成功 {{ stats.success7d }} / 总计 {{ stats.total7d }}
              </p>
            </div>
          </div>

          <div class="glass-card nodes-card">
            <div class="card-kicker">活动</div>
            <p class="nodes-desc">
              按近 7 日构建次数统计频率
            </p>
            <div class="nodes-big-row">
              <span class="nodes-num">{{ stats.total7d }}</span>
              <span class="nodes-unit">次构建</span>
            </div>
            <div class="bars-row">
              <div
                v-for="(pct, i) in stats.barPercents"
                :key="i"
                class="bar-col"
                :style="{ height: `${pct}%` }"
              />
            </div>
          </div>

          <button type="button" class="btn-add-project" @click="openAdd">
            <div class="btn-add-inner">
              <div class="btn-add-rings">
                <svg
                  class="btn-add-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <span class="btn-add-text">新增项目</span>
            </div>
          </button>
        </aside>

        <section class="main-panel">
          <div class="panel-header">
            <div class="panel-heading">
              <div class="panel-title-row">
                <h2 class="panel-title">
                  项目列表
                </h2>
                <div class="biz-tabs" role="tablist" aria-label="业务分类">
                  <button
                    v-for="tab in bizTabItems"
                    :key="tab.value"
                    type="button"
                    role="tab"
                    class="biz-tab"
                    :class="{ 'is-active': bizTab === tab.value }"
                    :aria-selected="bizTab === tab.value"
                    @click="bizTab = tab.value"
                  >
                    {{ tab.label }}
                  </button>
                </div>
              </div>
              <p class="panel-sub">
                实时环境与发布状态
              </p>
            </div>
            <div class="panel-tools">
              <button
                type="button"
                class="btn-filter"
                :class="{ 'is-open': filterOpen }"
                @click="toggleFilters"
              >
                Filters
              </button>
              <button type="button" class="btn-sync" @click="syncLogs">
                Sync Logs
              </button>
            </div>
          </div>

          <div v-show="filterOpen" class="filter-bar">
            <label class="filter-label">项目名称 · 模糊搜索</label>
            <input
              v-model="nameQuery"
              type="search"
              class="filter-input"
              placeholder="输入关键字过滤…"
              autocomplete="off"
            >
          </div>

          <div class="table-wrap">
            <div v-if="loading" class="table-loading">
              <span class="spinner" />
              <span class="loading-text">加载中</span>
            </div>

            <table class="data-table">
              <thead>
                <tr>
                  <th class="th-project">
                    项目
                  </th>
                  <th class="th-category">
                    分类
                  </th>
                  <th>当前状态</th>
                  <th>Node / Git</th>
                  <th>Endpoint</th>
                  <th class="th-jump">
                    部署页跳转
                  </th>
                  <th class="th-ops">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in filteredProjects"
                  :key="row.id"
                  class="data-row"
                  :style="{ animationDelay: `${0.02 * index}s` }"
                >
                  <td>
                    <div class="cell-project">
                      <span class="proj-name">{{ row.name }}</span>
                      <span class="proj-remark">{{ row.remark || '—' }}</span>
                    </div>
                  </td>
                  <td>
                    <span class="category-pill">{{
                      row.bizCategory ?? DEFAULT_BIZ_CATEGORY
                    }}</span>
                  </td>
                  <td>
                    <span
                      v-if="rowStatus(row) === 'building'"
                      class="badge badge-warn"
                    >
                      <span class="badge-spin" />
                      构建中
                    </span>
                    <span
                      v-else-if="rowStatus(row) === 'success'"
                      class="badge badge-ok"
                    >成功</span>
                    <span
                      v-else-if="rowStatus(row) === 'failed'"
                      class="badge badge-bad"
                    >失败</span>
                    <span
                      v-else
                      class="badge badge-idle"
                    >空闲</span>
                    <div
                      v-if="row.runtimeBuild?.active && row.runtimeBuild.step"
                      class="step-hint"
                    >
                      {{ row.runtimeBuild.step }}
                    </div>
                  </td>
                  <td>
                    <div class="cell-git">
                      <div class="git-branch">
                        <svg class="icon-git" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="6" y1="3" x2="6" y2="15" />
                          <circle cx="18" cy="6" r="3" />
                          <circle cx="6" cy="18" r="3" />
                          <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span class="truncate">{{ row.branch }}</span>
                      </div>
                      <span class="node-pill">v{{ row.nodeVersion }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="cell-endpoint">
                      <svg class="icon-srv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                        <line x1="6" y1="6" x2="6.01" y2="6" />
                        <line x1="6" y1="18" x2="6.01" y2="18" />
                      </svg>
                      <span>{{ row.serverIp || '—' }}</span>
                    </div>
                    <div class="last-ok">
                      成功 {{ formatDateTime(row.lastSuccessAt) }}
                    </div>
                  </td>
                  <td class="td-jump">
                    <button
                      v-if="row.loginUrl && String(row.loginUrl).trim()"
                      type="button"
                      class="btn-jump"
                      title="打开登录页"
                      @click="openLoginPage(row)"
                    >
                      <svg
                        class="icon-mouse"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
                      </svg>
                    </button>
                    <span v-else class="jump-empty">—</span>
                  </td>
                  <td class="td-ops">
                    <div class="ops-row">
                      <button
                        type="button"
                        class="op-btn op-primary"
                        title="构建"
                        :disabled="row.runtimeBuild?.active"
                        @click="openBuild(row)"
                      >
                        <svg class="op-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="op-btn"
                        title="编辑"
                        @click="openEdit(row)"
                      >
                        <svg class="op-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="op-btn op-danger"
                        title="删除"
                        @click="onDelete(row)"
                      >
                        <svg class="op-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <p
              v-if="!loading && filteredProjects.length === 0"
              class="empty-hint"
            >
              {{
                listFiltered
                  ? '无匹配项目'
                  : '暂无项目，请点击左侧「新增项目」'
              }}
            </p>
          </div>

          <div class="panel-footer">
            <span class="footer-count">
              共 {{ filteredProjects.length }} 条
              <template v-if="listFiltered">（已筛选）</template>
            </span>
            <button
              type="button"
              class="btn-refresh"
              @click="loadProjects({ kind: 'refresh' })"
            >
              <span class="ping-dot" />
              刷新列表
            </button>
          </div>
        </section>
      </div>

      <footer class="page-footer">
        <span class="footer-left">
          <span class="footer-dot" />
          内网发布控制台
        </span>
        <span class="footer-right">Editor By: Jinx</span>
      </footer>
    </div>

    <ProjectFormDialog
      v-model="formVisible"
      :editing="editingProject"
      @saved="loadProjects"
    />

    <ProjectBuildDialog
      v-model="buildVisible"
      :project="buildProject"
      @deploy-ended="onDeployEnded"
    />

    <DeployHistoryDrawer
      v-model="historyVisible"
      :project-id="historyProjectId"
      :project-name="historyProjectName"
    />
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
}

body {
  background: #050508;
}
</style>

<style scoped>
.release-app {
  min-height: 100vh;
  color: #f8fafc;
  font-family: ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
  overflow-x: hidden;
  position: relative;
  background: #050508;
}

.rel-shell {
  position: relative;
  z-index: 10;
  max-width: 1440px;
  margin: 0 auto;
  padding: 2rem 1.5rem 2.5rem;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

@media (min-width: 768px) {
  .rel-shell {
    padding: 2.5rem 2rem 2.5rem;
  }
}

.top-header {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

@media (min-width: 768px) {
  .top-header {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2.5rem;
  }
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo-tile {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #06b6d4, #6366f1);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 25px rgba(6, 182, 212, 0.3);
  color: #fff;
  flex-shrink: 0;
}

.main-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.text-cyan {
  color: #22d3ee;
}

.main-sub {
  margin: 0.25rem 0 0;
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-weight: 700;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  justify-content: flex-end;
}

.btn-ghost {
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.1);
}

.status-dot-wrap {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 8px rgba(148, 163, 184, 0.4);
  animation: pulse-dot 2s ease-in-out infinite;
}

.status-dot-wrap.is-online .status-dot {
  background: #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
}

.status-dot-wrap.is-offline .status-dot {
  background: #ef4444;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.55);
  animation: none;
}

.status-dot-wrap.is-unknown .status-dot {
  background: #94a3b8;
  box-shadow: 0 0 8px rgba(148, 163, 184, 0.4);
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.main-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  flex: 1;
}

@media (min-width: 1024px) {
  .main-grid {
    grid-template-columns: minmax(240px, 280px) 1fr;
    gap: 2rem;
  }
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.glass-card {
  border-radius: 24px;
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px);
  box-sizing: border-box;
}

.card-kicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #94a3b8;
  font-weight: 700;
}

.card-head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.health-pct {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: #34d399;
}

.health-card {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.health-body {
  margin-top: 0.75rem;
}

.health-label {
  font-size: 1.75rem;
  font-weight: 300;
  letter-spacing: -0.03em;
  color: #fff;
}

.health-bar-track {
  height: 6px;
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  margin-top: 1rem;
  overflow: hidden;
}

.health-bar-fill {
  height: 100%;
  background: #06b6d4;
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.5);
  border-radius: 999px;
  transition: width 0.7s ease-out;
}

.health-meta {
  margin: 0.5rem 0 0;
  font-size: 10px;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.nodes-card {
  min-height: 160px;
}

.nodes-desc {
  margin: 0.35rem 0 0;
  font-size: 10px;
  color: #64748b;
  line-height: 1.5;
}

.nodes-big-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.nodes-num {
  font-size: 3rem;
  font-weight: 200;
  letter-spacing: -0.04em;
  color: #fff;
  line-height: 1;
}

.nodes-unit {
  font-size: 11px;
  font-weight: 700;
  color: #22d3ee;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.bars-row {
  display: flex;
  gap: 6px;
  margin-top: 1rem;
  height: 40px;
  align-items: flex-end;
}

.bar-col {
  flex: 1;
  min-height: 8px;
  background: rgba(6, 182, 212, 0.22);
  border-radius: 2px 2px 0 0;
  transition: height 0.5s ease, background 0.15s;
}

.bar-col:hover {
  background: rgba(6, 182, 212, 0.45);
}

.btn-add-project {
  position: relative;
  min-height: 140px;
  border-radius: 32px;
  border: none;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  background: transparent;
  width: 100%;
}

.btn-add-project::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(6, 182, 212, 0.2),
    rgba(99, 102, 241, 0.2)
  );
  border: 1px solid rgba(6, 182, 212, 0.25);
  border-radius: 32px;
  backdrop-filter: blur(20px);
  transition: background 0.2s, border-color 0.2s;
}

.btn-add-project:hover::before {
  background: linear-gradient(
    135deg,
    rgba(6, 182, 212, 0.32),
    rgba(99, 102, 241, 0.32)
  );
  border-color: rgba(6, 182, 212, 0.45);
}

.btn-add-inner {
  position: relative;
  z-index: 1;
  height: 100%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
}

.btn-add-rings {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(6, 182, 212, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s, transform 0.5s;
}

.btn-add-project:hover .btn-add-rings {
  border-color: rgba(6, 182, 212, 0.55);
  transform: rotate(90deg);
}

.btn-add-icon {
  width: 24px;
  height: 24px;
  color: #22d3ee;
}

.btn-add-text {
  font-size: 11px;
  font-weight: 700;
  color: #cffafe;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.main-panel {
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 520px;
}

@media (min-width: 768px) {
  .main-panel {
    border-radius: 40px;
  }
}

.panel-header {
  padding: 1.5rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

@media (min-width: 768px) {
  .panel-header {
    padding: 2rem 2.5rem;
  }
}

.panel-title {
  margin: 0 0 0.25rem;
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: -0.02em;
}

.panel-sub {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.panel-heading {
  flex: 1;
  min-width: 0;
}

.panel-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 0.25rem;
}

.panel-title-row .panel-title {
  margin: 0;
}

.biz-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.2rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.biz-tab {
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}

.biz-tab:hover {
  color: #e2e8f0;
}

.biz-tab.is-active {
  background: rgba(6, 182, 212, 0.22);
  color: #67e8f9;
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.2);
}

.panel-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.btn-filter {
  padding: 0.5rem 1.25rem;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.btn-filter:hover,
.btn-filter.is-open {
  color: #67e8f9;
  border-color: rgba(6, 182, 212, 0.4);
}

.btn-sync {
  padding: 0.5rem 1.25rem;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: none;
  background: #06b6d4;
  color: #0f172a;
  cursor: pointer;
  box-shadow: 0 0 15px rgba(6, 182, 212, 0.4);
  transition: box-shadow 0.15s;
}

.btn-sync:hover {
  box-shadow: 0 0 25px rgba(6, 182, 212, 0.55);
}

.filter-bar {
  padding: 0.75rem 1.5rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
}

@media (min-width: 768px) {
  .filter-bar {
    padding-left: 2.5rem;
    padding-right: 2.5rem;
  }
}

.filter-label {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.filter-input {
  width: 100%;
  max-width: 360px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.35);
  color: #e2e8f0;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.filter-input::placeholder {
  color: #64748b;
}

.filter-input:focus {
  border-color: rgba(6, 182, 212, 0.5);
  box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.25);
}

.table-wrap {
  position: relative;
  flex: 1;
  overflow-x: auto;
  min-height: 420px;
}

.table-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 2px solid rgba(6, 182, 212, 0.25);
  border-top-color: #22d3ee;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

.loading-text {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table thead tr {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-weight: 700;
}

.data-table th {
  padding: 1.25rem 1rem;
  text-align: left;
  font-weight: 700;
}

.data-table .th-project {
  padding-left: 1.5rem;
}

@media (min-width: 768px) {
  .data-table .th-project {
    padding-left: 2.5rem;
  }
}

.data-table .th-category {
  width: 5.5rem;
  white-space: nowrap;
}

.data-table .th-jump {
  text-align: center;
  width: 100px;
}

.data-table .th-ops {
  text-align: right;
  padding-right: 1.5rem;
}

@media (min-width: 768px) {
  .data-table .th-ops {
    padding-right: 2.5rem;
  }
}

.data-row {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
  animation: fadeRow 0.35s ease-out both;
}

.data-row:hover {
  background: rgba(255, 255, 255, 0.02);
}

.data-table td {
  padding: 1rem 1rem;
  vertical-align: top;
}

.data-table td:first-child {
  padding-left: 1.5rem;
}

@media (min-width: 768px) {
  .data-table td:first-child {
    padding-left: 2.5rem;
  }
}

.td-jump {
  text-align: center;
  vertical-align: middle;
}

.btn-jump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(6, 182, 212, 0.35);
  background: rgba(6, 182, 212, 0.12);
  color: #22d3ee;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
}

.btn-jump:hover {
  background: rgba(6, 182, 212, 0.28);
  box-shadow: 0 0 16px rgba(6, 182, 212, 0.35);
  transform: scale(1.06);
}

.icon-mouse {
  width: 22px;
  height: 22px;
}

.jump-empty {
  color: #475569;
  font-size: 13px;
}

.td-ops {
  text-align: right;
  vertical-align: middle;
  padding-right: 1.5rem;
}

@media (min-width: 768px) {
  .td-ops {
    padding-right: 2.5rem;
  }
}

@keyframes fadeRow {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.cell-project {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.proj-name {
  font-size: 15px;
  font-weight: 600;
  color: #f1f5f9;
}

.category-pill {
  display: inline-block;
  padding: 0.2rem 0.55rem;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  color: #a5f3fc;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.35);
  white-space: nowrap;
}

.data-row:hover .proj-name {
  color: #22d3ee;
}

.proj-remark {
  font-size: 10px;
  color: #64748b;
  font-family: ui-monospace, monospace;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.badge-idle {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
}

.badge-warn {
  background: rgba(250, 204, 21, 0.12);
  color: #facc15;
}

.badge-ok {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}

.badge-bad {
  background: rgba(251, 113, 133, 0.12);
  color: #fb7185;
}

.badge-spin {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(250, 204, 21, 0.35);
  border-top-color: #facc15;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.step-hint {
  margin-top: 0.35rem;
  font-size: 10px;
  color: rgba(251, 191, 36, 0.95);
  font-family: ui-monospace, monospace;
}

.cell-git {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.git-branch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 12px;
  color: #94a3b8;
}

.icon-git {
  width: 12px;
  height: 12px;
  color: rgba(6, 182, 212, 0.7);
  flex-shrink: 0;
}

.truncate {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-pill {
  font-size: 9px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.05em;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  color: #64748b;
  width: fit-content;
}

.cell-endpoint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 13px;
  font-family: ui-monospace, monospace;
  color: #94a3b8;
}

.icon-srv {
  width: 14px;
  height: 14px;
  color: rgba(6, 182, 212, 0.4);
  flex-shrink: 0;
}

.last-ok {
  margin-top: 0.35rem;
  font-size: 10px;
  color: #475569;
  font-family: ui-monospace, monospace;
}

.ops-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  opacity: 0.75;
}

.data-row:hover .ops-row {
  opacity: 1;
}

.op-btn {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
  padding: 0;
}

.op-btn:hover:not(:disabled) {
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.08);
}

.op-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.op-primary {
  border-color: rgba(6, 182, 212, 0.35);
  background: rgba(6, 182, 212, 0.12);
  color: #22d3ee;
}

.op-primary:hover:not(:disabled) {
  background: #06b6d4;
  color: #0f172a;
}

.op-danger:hover:not(:disabled) {
  border-color: rgba(251, 113, 133, 0.4);
  color: #fb7185;
}

.op-ico {
  width: 16px;
  height: 16px;
}

.empty-hint {
  text-align: center;
  padding: 4rem 1.5rem;
  color: #64748b;
  font-size: 14px;
}

.panel-footer {
  padding: 1rem 1.5rem;
  background: rgba(255, 255, 255, 0.04);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

@media (min-width: 768px) {
  .panel-footer {
    padding: 1rem 2.5rem;
  }
}

.footer-count {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 11px;
  font-weight: 800;
  color: #22d3ee;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: none;
  border: none;
  cursor: pointer;
}

.btn-refresh:hover {
  color: #67e8f9;
}

.ping-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22d3ee;
  animation: ping 1.5s ease-out infinite;
}

@keyframes ping {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  75%,
  100% {
    opacity: 0;
    transform: scale(1.8);
  }
}

.page-footer {
  margin-top: 2rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.footer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #06b6d4;
  box-shadow: 0 0 5px rgba(6, 182, 212, 0.5);
}

.footer-right {
  font-family: ui-monospace, monospace;
  text-transform: none;
  color: #475569;
}
</style>
