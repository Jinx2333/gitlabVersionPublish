<script setup>
import { ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { createProject, updateProject } from '../api/projects.js';
import { NODE_VERSION_OPTIONS, DEFAULT_NODE_VERSION } from '../constants/nodeVersions.js';
import {
  BIZ_CATEGORY_OPTIONS,
  DEFAULT_BIZ_CATEGORY,
} from '../constants/bizCategories.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 为 null 表示新增；否则为待编辑项目（需含 id） */
  editing: { type: Object, default: null },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const emptyForm = () => ({
  name: '',
  gitUrl: '',
  branch: 'main',
  nodeVersion: DEFAULT_NODE_VERSION,
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  buildOnly: false,
  serverIp: '',
  sshSudoSuRoot: false,
  rootSwitchPassword: '',
  serverUser: '',
  serverPassword: '',
  serverPath: '',
  remark: '',
  loginUrl: '',
  bizCategory: DEFAULT_BIZ_CATEGORY,
});

const form = ref(emptyForm());
const formRef = ref();
const submitting = ref(false);

const isEdit = computed(() => Boolean(props.editing?.id));
const isBuildOnly = computed(() => Boolean(form.value.buildOnly));
const needsServerPassword = computed(
  () => !isBuildOnly.value && (!isEdit.value || props.editing?.buildOnly),
);
const serverPasswordPlaceholder = computed(() =>
  needsServerPassword.value ? 'SSH 密码' : '留空则不修改密码',
);

const title = computed(() => (isEdit.value ? '编辑项目' : '新增项目'));

const rules = computed(() => ({
  name: [{ required: true, message: '请输入项目名', trigger: 'blur' }],
  gitUrl: [{ required: true, message: '请输入 Git 地址', trigger: 'blur' }],
  branch: [{ required: true, message: '请输入分支', trigger: 'blur' }],
  nodeVersion: [{ required: true, message: '请选择 Node 版本', trigger: 'change' }],
  installCommand: [{ required: true, message: '请输入依赖安装命令', trigger: 'blur' }],
  buildCommand: [{ required: true, message: '请输入打包命令', trigger: 'blur' }],
  serverIp: isBuildOnly.value
    ? []
    : [{ required: true, message: '请输入服务器 IP', trigger: 'blur' }],
  serverUser: isBuildOnly.value
    ? []
    : [{ required: true, message: '请输入服务器账号', trigger: 'blur' }],
  serverPassword: needsServerPassword.value
    ? [{ required: true, message: '请输入服务器密码', trigger: 'blur' }]
    : [],
  serverPath: isBuildOnly.value
    ? []
    : [{ required: true, message: '请输入服务器资源目录', trigger: 'blur' }],
  bizCategory: [{ required: true, message: '请选择业务分类', trigger: 'change' }],
  rootSwitchPassword: [
    {
      validator: (_rule, v, cb) => {
        if (isBuildOnly.value || !form.value.sshSudoSuRoot) {
          cb();
          return;
        }
        if (isEdit.value && !String(v ?? '').trim()) {
          cb();
          return;
        }
        if (!isEdit.value && !String(v ?? '').trim()) {
          cb(new Error('勾选「切换 root」时请填写切换密码'));
          return;
        }
        cb();
      },
      trigger: 'blur',
    },
  ],
}));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    if (props.editing?.id) {
      const {
        serverPassword: _sp,
        rootSwitchPassword: _rp,
        ...rest
      } = props.editing;
      form.value = {
        ...emptyForm(),
        ...rest,
        serverPassword: '',
        rootSwitchPassword: '',
      };
    } else {
      form.value = emptyForm();
    }
  },
);

function onClose() {
  visible.value = false;
}

async function onSubmit() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  submitting.value = true;
  try {
    const payload = { ...form.value };
    if (payload.buildOnly) {
      payload.sshSudoSuRoot = false;
      payload.rootSwitchPassword = '';
      payload.serverIp = '';
      payload.serverUser = '';
      payload.serverPassword = '';
      payload.serverPath = '';
      payload.loginUrl = '';
    }
    if (!payload.sshSudoSuRoot) {
      payload.rootSwitchPassword = '';
    }
    if (isEdit.value && !String(payload.serverPassword ?? '').trim()) {
      delete payload.serverPassword;
    }
    if (isEdit.value && !String(payload.rootSwitchPassword ?? '').trim()) {
      delete payload.rootSwitchPassword;
    }
    if (isEdit.value) {
      await updateProject(props.editing.id, payload);
      ElMessage.success('已保存');
    } else {
      await createProject(payload);
      ElMessage.success('已创建');
    }
    emit('saved');
    visible.value = false;
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="project-form-dialog"
    modal-class="project-form-dialog-overlay"
    width="640px"
    top="5vh"
    destroy-on-close
    @closed="formRef?.resetFields?.()"
  >
    <template #header>
      <div class="dlg-head">
        <div class="dlg-title">{{ title }}</div>
        <div class="dlg-sub">
          {{ isEdit ? '维护项目发布配置与服务器连接信息' : '创建新的发布项目配置' }}
        </div>
      </div>
    </template>
    <el-form
      ref="formRef"
      class="project-form"
      :model="form"
      :rules="rules"
      autocomplete="off"
      label-width="120px"
      label-position="right"
    >
      <el-form-item label="业务分类" prop="bizCategory">
        <el-select
          v-model="form.bizCategory"
          popper-class="project-form-popper"
          placeholder="请选择业务分类"
          style="width: 100%"
        >
          <el-option
            v-for="c in BIZ_CATEGORY_OPTIONS"
            :key="c"
            :label="c"
            :value="c"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="项目名" prop="name">
        <el-input v-model="form.name" placeholder="例如：运营后台 H5" clearable />
      </el-form-item>
      <el-form-item label="Git 地址" prop="gitUrl">
        <el-input
          v-model="form.gitUrl"
          placeholder="支持 http://内网IP/项目.git、无协议 host/group/repo.git、或 git@host:group/repo.git"
          clearable
        />
      </el-form-item>
      <el-form-item label="分支" prop="branch">
        <el-input v-model="form.branch" placeholder="main / develop / release" clearable />
      </el-form-item>
      <el-form-item label="Node 版本" prop="nodeVersion">
        <el-select
          v-model="form.nodeVersion"
          placeholder="选择 Node 版本"
          popper-class="project-form-popper"
          style="width: 100%"
        >
          <el-option
            v-for="v in NODE_VERSION_OPTIONS"
            :key="v"
            :label="`v${v}`"
            :value="v"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="依赖安装命令" prop="installCommand">
        <el-input
          v-model="form.installCommand"
          placeholder="npm ci / npm install；pnpm 项目可填 pnpm install 或 corepack enable && pnpm install"
          clearable
        />
      </el-form-item>
      <el-form-item label="打包命令" prop="buildCommand">
        <el-input
          v-model="form.buildCommand"
          placeholder="npm run build"
          clearable
        />
      </el-form-item>
      <el-form-item label=" ">
        <el-checkbox v-model="form.buildOnly">
          只打包，不发布
        </el-checkbox>
      </el-form-item>
      <template v-if="!form.buildOnly">
        <el-form-item label="服务器 IP" prop="serverIp">
          <el-input v-model="form.serverIp" placeholder="10.0.0.12" clearable />
        </el-form-item>
        <el-form-item label=" ">
          <el-checkbox v-model="form.sshSudoSuRoot">
            登录后切换 root 账号（远程通过 sudo -S 提权执行部署）
          </el-checkbox>
        </el-form-item>
        <el-form-item
          v-if="form.sshSudoSuRoot"
          label="切换密码"
          prop="rootSwitchPassword"
        >
          <el-input
            v-model="form.rootSwitchPassword"
            type="password"
            :placeholder="isEdit ? '留空则沿用已保存的切换密码' : 'sudo / su 提权用密码'"
            autocomplete="new-password"
            clearable
          />
        </el-form-item>
        <el-form-item label="服务器账号" prop="serverUser">
          <el-input v-model="form.serverUser" placeholder="SSH 登录用户名" clearable />
        </el-form-item>
        <el-form-item label="服务器密码" prop="serverPassword">
          <el-input
            v-model="form.serverPassword"
            type="password"
            :placeholder="serverPasswordPlaceholder"
            :autocomplete="isEdit ? 'new-password' : 'new-password'"
            clearable
          />
        </el-form-item>
        <el-form-item label="资源目录" prop="serverPath">
          <el-input
            v-model="form.serverPath"
            placeholder="远端静态资源路径，如 /var/www/html/app"
            clearable
          />
        </el-form-item>
      </template>
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="2"
          placeholder="可选：说明、联系人等"
        />
      </el-form-item>
      <el-form-item v-if="!form.buildOnly" label="登录页地址" prop="loginUrl">
        <el-input
          v-model="form.loginUrl"
          placeholder="可选：发布后访问的登录页，如 https://app.example.com/login"
          clearable
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="onClose">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.project-form-dialog-overlay) {
  background-color: rgba(5, 5, 8, 0.72) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:global(.project-form-dialog) {
  --el-dialog-bg-color: transparent;
  --el-text-color-primary: #f8fafc;
  --el-text-color-regular: #cbd5e1;
  --el-text-color-placeholder: #64748b;
  --el-border-color: rgba(255, 255, 255, 0.1);
  --el-border-color-light: rgba(255, 255, 255, 0.08);
  --el-fill-color-blank: rgba(15, 23, 42, 0.58);
  --el-fill-color-light: rgba(255, 255, 255, 0.05);
  margin-top: 5vh !important;
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

:global(.project-form-dialog .el-dialog__header) {
  margin: 0;
  padding: 0;
}

:global(.project-form-dialog .el-dialog__headerbtn) {
  top: 16px;
  right: 16px;
  width: 38px;
  height: 38px;
}

:global(.project-form-dialog .el-dialog__close) {
  color: rgba(248, 250, 252, 0.6);
}

:global(.project-form-dialog .el-dialog__headerbtn:hover .el-dialog__close) {
  color: #22d3ee;
}

:global(.project-form-dialog .el-dialog__body) {
  max-height: min(70vh, 680px);
  overflow-y: auto;
  padding: 18px 24px 8px;
  color: #e2e8f0;
}

:global(.project-form-dialog .el-dialog__footer) {
  padding: 14px 24px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
}

:global(.project-form-dialog .dlg-head) {
  padding: 20px 56px 16px 24px;
  border-bottom: 1px solid rgba(6, 182, 212, 0.18);
  background: rgba(255, 255, 255, 0.04);
}

:global(.project-form-dialog .dlg-title) {
  font-size: 18px;
  font-weight: 700;
  color: #f8fafc;
}

:global(.project-form-dialog .dlg-sub) {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}

:global(.project-form .el-form-item__label) {
  color: #94a3b8;
  font-weight: 700;
}

:global(.project-form .el-input__wrapper),
:global(.project-form .el-textarea__inner),
:global(.project-form .el-select__wrapper) {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(15, 23, 42, 0.62);
  box-shadow: none;
  color: #e2e8f0;
}

:global(.project-form .el-input__wrapper:hover),
:global(.project-form .el-textarea__inner:hover),
:global(.project-form .el-select__wrapper:hover) {
  border-color: rgba(6, 182, 212, 0.34);
}

:global(.project-form .el-input__wrapper.is-focus),
:global(.project-form .el-textarea__inner:focus),
:global(.project-form .el-select__wrapper.is-focused) {
  border-color: rgba(6, 182, 212, 0.62);
  box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.22);
}

:global(.project-form .el-input__inner),
:global(.project-form .el-textarea__inner) {
  color: #e2e8f0;
}

:global(.project-form .el-checkbox__label) {
  color: #cbd5e1;
  line-height: 1.5;
}

:global(.project-form .el-checkbox__input.is-checked .el-checkbox__inner) {
  border-color: #06b6d4;
  background-color: #06b6d4;
}

:global(.project-form-dialog .el-dialog__footer .el-button) {
  border-radius: 999px;
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
}

:global(.project-form-dialog .el-dialog__footer .el-button:hover) {
  border-color: rgba(6, 182, 212, 0.4);
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.1);
}

:global(.project-form-dialog .el-dialog__footer .el-button--primary) {
  border: none;
  background: #06b6d4;
  color: #0f172a;
  font-weight: 800;
  box-shadow: 0 0 18px rgba(6, 182, 212, 0.36);
}

:global(.project-form-dialog .el-dialog__footer .el-button--primary:hover) {
  background: #22d3ee;
  color: #0f172a;
  box-shadow: 0 0 26px rgba(6, 182, 212, 0.5);
}

:global(.project-form-popper.el-popper) {
  border-color: rgba(6, 182, 212, 0.24) !important;
  background: rgba(10, 16, 28, 0.96) !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

:global(.project-form-popper .el-select-dropdown__item) {
  color: #cbd5e1;
}

:global(.project-form-popper .el-select-dropdown__item.hover),
:global(.project-form-popper .el-select-dropdown__item:hover) {
  background: rgba(6, 182, 212, 0.14);
}

:global(.project-form-popper .el-select-dropdown__item.is-selected) {
  color: #67e8f9;
}

:global(.project-form-popper .el-popper__arrow::before) {
  background: rgba(10, 16, 28, 0.96) !important;
  border-color: rgba(6, 182, 212, 0.24) !important;
}
</style>
