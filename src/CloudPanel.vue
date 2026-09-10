<script setup>
import { ref } from 'vue'
import { t } from './i18n.mjs'
import { label } from './reconciliation.mjs'
defineProps({configured:Boolean,connected:Boolean,busy:Boolean,status:String,error:String,email:String,revision:Number,savedAt:[String,Number],deleted:Array})
const emit=defineEmits(['connect','disconnect','restore'])
const emailInput=ref(''),password=ref('')
const l=(zh,en)=>t(label(zh,en))
function login(){emit('connect',{email:emailInput.value,password:password.value});password.value=''}
</script>
<template><section class="cloud-panel ops">
  <div class="cloud-title"><div><h2>{{l('数据保存与同步','Data saving & synchronization')}}</h2><p>{{l('SAP 原始数据与平台协作记录分别保存','SAP source data and platform collaboration are stored separately')}}</p></div><span class="demo-chip">{{connected?'Firebase':l('未连接云端','Cloud disconnected')}}</span></div>
  <div class="cloud-status-grid"><div><small>{{l('网页操作','Web operations')}}</small><strong>{{status}}</strong><span v-if="savedAt">{{l('上次保存','Last saved')}} · {{new Date(savedAt).toLocaleString()}}</span></div><div><small>{{l('SAP 定时同步','Scheduled SAP sync')}}</small><strong>{{l('待启用内网同步程序','Internal sync agent not enabled')}}</strong><span>{{l('尚未启动定时任务；当前页面仍为样本数据','No schedule is active; this page still uses sample data')}}</span></div></div>
  <p v-if="!configured" class="ops-note">{{l('保存模块已加入，等待 Firebase 项目权限与登录配置。当前操作仍只保留在本次页面会话，请勿录入真实业务数据。','Saving is implemented, pending Firebase project access and sign-in setup. Current changes are session-only. Do not enter real business data.')}}</p>
  <form v-else-if="!connected" class="cloud-login" @submit.prevent="login"><label>{{l('已授权的邮箱','Authorized email')}}<input v-model="emailInput" type="email" required autocomplete="username"/></label><label>{{l('密码','Password')}}<input v-model="password" type="password" required autocomplete="current-password"/></label><button type="submit" :disabled="busy">{{l('登录并加载已保存记录','Sign in & load saved records')}}</button></form>
  <div v-else class="cloud-account"><span>{{email}} · {{l('保存版本','Saved revision')}} {{revision}}</span><button :disabled="busy" @click="emit('disconnect')">{{l('退出云端工作区','Leave cloud workspace')}}</button></div>
  <p v-if="error" role="alert" class="ops-error">{{error}}</p>
  <details v-if="deleted?.length" class="cloud-recycle"><summary>{{l('已删除的报发记录','Deleted dispatch records')}} · {{deleted.length}}</summary><div v-for="s in deleted" :key="s.id"><b>{{s.id}}</b><span>{{s.deleteReason}}</span><button :disabled="busy" @click="emit('restore',s)">{{l('恢复记录','Restore record')}}</button></div></details>
</section></template>
