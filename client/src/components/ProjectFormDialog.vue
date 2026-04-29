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
  serverIp: '',
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

const title = computed(() => (isEdit.value ? '编辑项目' : '新增项目'));

const rules = {
  name: [{ required: true, message: '请输入项目名', trigger: 'blur' }],
  gitUrl: [{ required: true, message: '请输入 Git 地址', trigger: 'blur' }],
  branch: [{ required: true, message: '请输入分支', trigger: 'blur' }],
  nodeVersion: [{ required: true, message: '请选择 Node 版本', trigger: 'change' }],
  installCommand: [{ required: true, message: '请输入依赖安装命令', trigger: 'blur' }],
  buildCommand: [{ required: true, message: '请输入打包命令', trigger: 'blur' }],
  serverIp: [{ required: true, message: '请输入服务器 IP', trigger: 'blur' }],
  serverUser: [{ required: true, message: '请输入服务器账号', trigger: 'blur' }],
  serverPassword: [{ required: true, message: '请输入服务器密码', trigger: 'blur' }],
  serverPath: [{ required: true, message: '请输入服务器资源目录', trigger: 'blur' }],
  bizCategory: [{ required: true, message: '请选择业务分类', trigger: 'change' }],
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    form.value = props.editing?.id
      ? { ...emptyForm(), ...props.editing }
      : emptyForm();
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
    :title="title"
    width="640px"
    destroy-on-close
    @closed="formRef?.resetFields?.()"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="120px"
      label-position="right"
    >
      <el-form-item label="业务分类" prop="bizCategory">
        <el-select
          v-model="form.bizCategory"
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
        <el-select v-model="form.nodeVersion" placeholder="选择 Node 版本" style="width: 100%">
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
      <el-form-item label="服务器 IP" prop="serverIp">
        <el-input v-model="form.serverIp" placeholder="10.0.0.12" clearable />
      </el-form-item>
      <el-form-item label="服务器账号" prop="serverUser">
        <el-input v-model="form.serverUser" placeholder="SSH 登录用户名" clearable />
      </el-form-item>
      <el-form-item label="服务器密码" prop="serverPassword">
        <el-input
          v-model="form.serverPassword"
          type="password"
          show-password
          placeholder="SSH 密码"
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
      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="2"
          placeholder="可选：说明、联系人等"
        />
      </el-form-item>
      <el-form-item label="登录页地址" prop="loginUrl">
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
