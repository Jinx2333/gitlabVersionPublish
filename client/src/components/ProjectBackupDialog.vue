<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  createProjectBackup,
  deleteProjectBackup,
  downloadProjectBackup,
  fetchProjectBackups,
} from '../api/projects.js';
import { formatDateTime } from '../utils/format.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  project: { type: Object, default: null },
});

const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const rows = ref([]);
const loading = ref(false);
const creating = ref(false);
const deletingFilename = ref('');

async function loadBackups() {
  if (!props.project?.id) return;
  loading.value = true;
  try {
    rows.value = await fetchProjectBackups(props.project.id);
  } catch (e) {
    ElMessage.error(e.message || '加载备份失败');
  } finally {
    loading.value = false;
  }
}

async function onCreateBackup() {
  if (!props.project?.id) return;
  creating.value = true;
  try {
    await createProjectBackup(props.project.id);
    ElMessage.success('备份创建成功');
    await loadBackups();
  } catch (e) {
    ElMessage.error(e.message || '创建备份失败');
  } finally {
    creating.value = false;
  }
}

async function onDownload(row) {
  if (!props.project?.id) return;
  try {
    await downloadProjectBackup(props.project.id, row.filename);
    ElMessage.success('已开始下载');
  } catch (e) {
    ElMessage.error(e.message || '下载失败');
  }
}

async function onDelete(row) {
  if (!props.project?.id) return;
  deletingFilename.value = row.filename;
  try {
    await deleteProjectBackup(props.project.id, row.filename);
    ElMessage.success('备份已删除');
    await loadBackups();
  } catch (e) {
    ElMessage.error(e.message || '删除失败');
  } finally {
    deletingFilename.value = '';
  }
}

function formatSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

watch(
  () => [props.modelValue, props.project?.id],
  ([open]) => {
    if (open) loadBackups();
  },
);
</script>

<template>
  <el-dialog
    v-model="visible"
    class="backup-dialog"
    modal-class="backup-dialog-overlay"
    width="760px"
    top="6vh"
    destroy-on-close
  >
    <template #header>
      <div class="dlg-head">
        <div>
          <div class="dlg-title">项目备份</div>
          <div class="dlg-sub">{{ project?.name || '—' }}</div>
        </div>
      </div>
    </template>

    <div class="backup-toolbar">
      <div>
        <div class="toolbar-title">备份列表</div>
        <div class="toolbar-sub">每个项目最多保留 5 个备份</div>
      </div>
      <el-button
        type="primary"
        :loading="creating"
        :disabled="project?.buildOnly"
        @click="onCreateBackup"
      >
        创建新备份
      </el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      stripe
      border
      class="backup-table"
      max-height="380"
      empty-text="暂无备份"
    >
      <el-table-column
        prop="filename"
        label="文件名"
        min-width="360"
        show-overflow-tooltip
      />
      <el-table-column label="大小" width="110">
        <template #default="{ row }">
          {{ formatSize(row.size) }}
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" align="center" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button type="primary" link @click="onDownload(row)">
              下载
            </el-button>
            <el-button
              type="danger"
              link
              :loading="deletingFilename === row.filename"
              @click="onDelete(row)"
            >
              删除
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<style scoped>
:global(.backup-dialog-overlay) {
  background-color: rgba(5, 5, 8, 0.72) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:global(.backup-dialog) {
  --el-dialog-bg-color: transparent;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: rgba(15, 23, 42, 0.38);
  --el-table-header-bg-color: rgba(15, 23, 42, 0.68);
  --el-table-row-hover-bg-color: rgba(6, 182, 212, 0.08);
  --el-table-border-color: rgba(255, 255, 255, 0.08);
  --el-table-text-color: #e2e8f0;
  --el-table-header-text-color: #94a3b8;
  margin-top: 6vh !important;
  padding: 0;
  border-radius: 28px;
  overflow: hidden;
  border: 1px solid rgba(6, 182, 212, 0.24);
  background:
    linear-gradient(135deg, rgba(6, 182, 212, 0.16), rgba(99, 102, 241, 0.12)),
    rgba(5, 5, 8, 0.88) !important;
  backdrop-filter: blur(22px) saturate(1.15);
  -webkit-backdrop-filter: blur(22px) saturate(1.15);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06) inset,
    0 0 46px rgba(6, 182, 212, 0.14),
    0 26px 70px rgba(0, 0, 0, 0.58);
}

:global(.backup-dialog .el-dialog__header) {
  margin: 0;
  padding: 0;
}

:global(.backup-dialog .el-dialog__body) {
  padding: 18px 24px 24px;
  color: #e2e8f0;
}

:global(.backup-dialog .el-table),
:global(.backup-dialog .el-table__inner-wrapper),
:global(.backup-dialog .el-table__body-wrapper),
:global(.backup-dialog .el-table__header-wrapper),
:global(.backup-dialog .el-table tr),
:global(.backup-dialog .el-table th.el-table__cell),
:global(.backup-dialog .el-table td.el-table__cell) {
  background: transparent !important;
}

:global(.backup-dialog .el-table th.el-table__cell) {
  background: rgba(15, 23, 42, 0.72) !important;
}

:global(.backup-dialog .el-table td.el-table__cell) {
  background: rgba(15, 23, 42, 0.36) !important;
}

:global(.backup-dialog .el-table__row:hover td.el-table__cell) {
  background: rgba(6, 182, 212, 0.1) !important;
}

:global(.backup-dialog .el-loading-mask) {
  background: rgba(5, 5, 8, 0.72);
}

:global(.backup-dialog .el-dialog__headerbtn:hover .el-dialog__close) {
  color: #22d3ee;
}

.dlg-head {
  padding: 20px 56px 16px 24px;
  border-bottom: 1px solid rgba(6, 182, 212, 0.18);
  background: rgba(255, 255, 255, 0.04);
}

.dlg-title {
  font-size: 18px;
  font-weight: 700;
  color: #f8fafc;
}

.dlg-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}

.backup-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}

.toolbar-title {
  font-size: 13px;
  font-weight: 700;
  color: #f1f5f9;
}

.toolbar-sub {
  margin-top: 4px;
  font-size: 11px;
  color: #64748b;
}

.backup-toolbar :deep(.el-button) {
  border: none;
  border-radius: 999px;
  background: #06b6d4;
  color: #0f172a;
  font-weight: 800;
  box-shadow: 0 0 18px rgba(6, 182, 212, 0.36);
}

.backup-toolbar :deep(.el-button:hover) {
  background: #22d3ee;
  color: #0f172a;
  box-shadow: 0 0 26px rgba(6, 182, 212, 0.5);
}

.backup-toolbar :deep(.el-button.is-disabled) {
  background: rgba(148, 163, 184, 0.18);
  color: #64748b;
  box-shadow: none;
}

.backup-table {
  border-radius: 10px;
  overflow: hidden;
}

:global(.backup-dialog .backup-table .el-table__inner-wrapper::before) {
  display: none;
}

:global(.backup-dialog .el-table__empty-text) {
  color: #64748b;
}

:global(.backup-dialog .el-button.is-link) {
  --el-button-text-color: #22d3ee;
}

:global(.backup-dialog .el-button.is-link:hover) {
  color: #67e8f9;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.row-actions :deep(.el-button--danger.is-link) {
  color: #fb7185;
}

.row-actions :deep(.el-button--danger.is-link:hover) {
  color: #fda4af;
}
</style>
