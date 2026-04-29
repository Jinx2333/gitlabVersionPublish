<script setup>
import { ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchLogDetail } from '../api/logs.js';
import { formatDateTime, formatDuration } from '../utils/format.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  logId: { type: String, default: null },
});

const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const loading = ref(false);
const entry = ref(null);

watch(
  () => [props.modelValue, props.logId],
  ([open, id]) => {
    if (open && id) {
      load();
    } else if (!open) {
      entry.value = null;
    }
  },
);

async function load() {
  if (!props.logId) return;
  loading.value = true;
  entry.value = null;
  try {
    entry.value = await fetchLogDetail(props.logId);
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
</script>

<template>
  <el-dialog
    v-model="visible"
    title="发布日志详情"
    width="720px"
    destroy-on-close
  >
    <div v-loading="loading" class="detail-wrap">
      <template v-if="entry">
        <div class="meta">
          <div><strong>项目</strong>：{{ entry.projectName }}</div>
          <div><strong>状态</strong>：
            <el-tag :type="statusType(entry.status)" size="small">{{ entry.status }}</el-tag>
          </div>
          <div><strong>开始</strong>：{{ formatDateTime(entry.startedAt) }}</div>
          <div><strong>结束</strong>：{{ formatDateTime(entry.finishedAt) }}</div>
          <div v-if="entry.summary" class="meta-full"><strong>摘要</strong>：{{ entry.summary }}</div>
          <div class="meta-full">
            <strong>发布 IP</strong>：{{ entry.publisherIp || '—' }}
          </div>
        </div>

        <div
          v-if="entry.pipelineSteps && entry.pipelineSteps.length"
          class="pipeline-block"
        >
          <div class="pipe-title">流水线步骤</div>
          <el-timeline>
            <el-timeline-item
              v-for="s in entry.pipelineSteps"
              :key="s.id"
              :timestamp="`${formatDuration(s.durationMs)}`"
              placement="top"
            >
              <div class="pipe-line-title">{{ s.label }}</div>
              <div class="pipe-line-sub">
                {{ formatDateTime(s.startedAt) }} → {{ formatDateTime(s.finishedAt) }}
              </div>
            </el-timeline-item>
          </el-timeline>
        </div>

        <div class="terminal">
          <pre class="terminal-pre">{{ entry.logText || '（无控制台输出）' }}</pre>
        </div>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.detail-wrap {
  min-height: 120px;
}

.meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  font-size: 13px;
  margin-bottom: 12px;
  color: #606266;
}

.meta-full {
  grid-column: 1 / -1;
}

.pipeline-block {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.pipe-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: #334155;
}

.pipe-line-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.pipe-line-sub {
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, Consolas, monospace;
}

.terminal {
  max-height: 50vh;
  overflow: auto;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
}

.terminal-pre {
  margin: 0;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  color: #e6edf3;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
