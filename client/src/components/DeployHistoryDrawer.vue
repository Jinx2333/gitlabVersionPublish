<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchDeployLogList } from '../api/logs.js';
import { formatDateTime } from '../utils/format.js';
import LogDetailDialog from './LogDetailDialog.vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 传入则只显示该项目的记录；不传为全部 */
  projectId: { type: String, default: null },
  projectName: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const visible = ref(false);
const loading = ref(false);
const rows = ref([]);
const detailVisible = ref(false);
const selectedLogId = ref(null);

const titleText = ref('发布总日志');

watch(
  () => props.modelValue,
  (v) => {
    visible.value = v;
    if (v) {
      titleText.value = props.projectId
        ? `发布日志 — ${props.projectName || props.projectId}`
        : '发布总日志';
      load();
    }
  },
);

watch(visible, (v) => emit('update:modelValue', v));

watch(
  () => props.projectId,
  () => {
    if (visible.value) load();
  },
);

async function load() {
  loading.value = true;
  try {
    rows.value = await fetchDeployLogList({
      projectId: props.projectId || undefined,
      limit: 100,
    });
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function statusType(s) {
  if (s === 'success') return 'success';
  if (s === 'failed') return 'danger';
  return 'info';
}

function openDetail(row) {
  selectedLogId.value = row.id;
  detailVisible.value = true;
}
</script>

<template>
  <el-drawer v-model="visible" :title="titleText" size="640px" destroy-on-close>
    <div v-loading="loading" class="drawer-inner">
      <div class="toolbar">
        <el-button type="primary" link @click="load">刷新</el-button>
      </div>
      <el-table
        :data="rows"
        stripe
        border
        height="calc(100vh - 200px)"
        empty-text="暂无发布记录"
        @row-dblclick="openDetail"
      >
        <el-table-column prop="projectName" label="项目" min-width="120" show-overflow-tooltip />
        <el-table-column label="状态" width="88" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="summary" label="摘要" min-width="120" show-overflow-tooltip />
        <el-table-column
          prop="publisherIp"
          label="发布 IP"
          width="130"
          show-overflow-tooltip
        />
        <el-table-column label="结束时间" width="168">
          <template #default="{ row }">
            {{ formatDateTime(row.finishedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="96" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="hint">提示：双击一行可快速打开详情</p>
    </div>

    <LogDetailDialog v-model="detailVisible" :log-id="selectedLogId" />
  </el-drawer>
</template>

<style scoped>
.drawer-inner {
  min-height: 200px;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
