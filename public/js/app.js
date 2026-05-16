// app.js - Main entry point (ES Module)
// Vue is loaded globally via CDN
const { createApp, ref, reactive, computed, onMounted, watch, nextTick } = Vue;

// Import all state
import {
  user, currentView, apiKeys, cards, toasts,
  keyForm, editingKey, modelList, fetchingModels,
  createStep, generating, generatingCover, finalizing,
  streamOutput, currentGenStep, results, previewTab, editingResult,
  coverPreview, coverBase64, showSuccessModal, successDownloadUrl,
  characterProgress, worldbookEntries, drafts, showDrafts,
  autosaveStatus, autosaveAt,
  templateEditor, templateNameMap, templateNames,
  importedRegexScripts, importedTavernHelperScripts,
  novelImport, editingCardId, editorLoading, editorSaving, editorData, editorEntries,
  editorCoverPreview, editorCoverBase64, editorDescPreview, editorGreetingPreview,
  agentChat, prefillCOTSetting,
  refineOpen, refineMessages, refineInput, refineSending,
  regexCustomize, regexStylePresets, regexAIStyleOptions, regexAIColorOptions, regexAIElementOptions,
  toggleExtra, cardForm, steps, stepLabels,
  charWBGenerated, generatingCharWBIndex, generatingTags, importingCard, importingCardToLibrary,
  colorDotMap, statusBarSectionOptions, flags, extraGenDone,
} from './state.js';

// Import utils
import {
  toast, renderMarkdown, providerLabel, providerBadgeClass, formatDate,
  particleStyle, escapeHtml, isRenderableRegex, stripCodeBlock,
} from './utils.js';

// Import draft functions
import {
  loadDrafts, saveDraft, restoreDraft, deleteDraft, formatDraftTime, hasCreateContent,
  loadUserTemplates, openTemplateEditor, switchTemplate, saveCustomTemplate, resetTemplate, isTemplateCustomized,
  saveAutoDraft, loadAutoDraft, clearAutoDraft,
} from './draft.js';

// Import character functions
import {
  addCharacter, removeCharacter, addVariable, removeVariable,
  loadPresetVariables, clearAllVariables,
  buildStatusBarInput, buildGreetingBeautifyInput,
} from './character.js';

// Import worldbook functions
import {
  parseWorldbookFromMarkdown, parseWorldbookFromMarkdownSafe, parseXYAMLEntries, syncWorldbookToMarkdown,
  addWorldbookEntry, removeWorldbookEntry, toggleEntryType, updateEntryKeywords, insertEjsCondition,
  setupWorldbookWatcher, generateSingleCharacterWB,
  ejsPreviewCode,
} from './worldbook.js';

// Import generate/API functions
import {
  generateStep, generateCoverTags, generateCover, uploadCover,
  importCard, importCardToLibrary, finalizeCard, deleteCard,
  resetCreateState, toggleEditResult, goToStep, generateExtraReq,
  checkAuth, logout, saveApiKey, editApiKey, cancelEditKey, deleteApiKey, fetchModels, loadCards,
} from './generate.js';

// Import editor functions
import {
  startEditCard, addEditorEntry, removeEditorEntry, moveEditorEntry,
  uploadEditorCover, saveEditorCard,
  parsePresetJSON, handlePresetUpload, startAgentChat,
  sendAgentMessage, extractAndFinalize, resetAgentChat, renderAgentMessage,
  toggleRefine, sendRefineMessage, applyChange, renderRefineMessage, clearRefineChat,
  setupRefineGlobalHandlers,
  getRegexPanel, toggleRegexStylePanel, toggleRegexAIPanel, toggleRegexSource,
  getRegexSrcdoc, getRegexLiveSrcdoc, updateRegexCSSVar,
  applyRegexCSSChanges, resetRegexCSSChanges, applyRegexPreset,
  toggleRegexAIOption, startRegexAIRewrite, setupRegexIframeResize,
} from './editor.js';

// Import novel functions
import { handleNovelFile, reDecodeNovel, rechunkNovel, startNovelExtract, generateNovelWorldbook } from './novel.js';

const app = createApp({
  setup() {
    // ===== Computed =====
    const avatarUrl = computed(() => {
      const u = user.user;
      if (!u || !u.avatar) return '';
      return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.webp?size=64`;
    });

    const textAIKeys = computed(() => apiKeys.value.filter(k => ['openai', 'gemini_native', 'claude_native'].includes(k.provider)));
    const imageAIKeys = computed(() => apiKeys.value.filter(k => ['novelai', 'custom_image'].includes(k.provider)));
    const cardCount = computed(() => cards.value.length);
    const hasAnyResult = computed(() => Object.values(results).some(v => v));

    const hasCharacterInput = computed(() => {
      return cardForm.characters.some(char => {
        if (char.mode === 'simple') return char.nameSimple && char.input;
        return char.name;
      });
    });

    const characterNameList = computed(() => {
      return cardForm.characters
        .map(c => c.mode === 'simple' ? c.nameSimple : c.name)
        .filter(n => n);
    });

    const renderedOutput = computed(() => {
      if (!streamOutput.value) return '';
      try {
        return marked.parse(streamOutput.value);
      } catch {
        return streamOutput.value;
      }
    });

    const namedMvuVariables = computed(() => cardForm.mvuVariables.filter(v => v.name));

    function appendExtraReq(text) {
      if (cardForm.extraRequirements && cardForm.extraRequirements.includes(text)) {
        toast('已添加过该项', 'warning');
        return;
      }
      cardForm.extraRequirements = (cardForm.extraRequirements ? cardForm.extraRequirements + '\n' : '') + text;
    }

    const baseUrlPlaceholder = computed(function () {
      var map = {
        openai: 'https://api.openai.com',
        gemini_native: 'https://generativelanguage.googleapis.com',
        claude_native: 'https://api.anthropic.com',
      };
      return map[keyForm.provider] || 'https://api.openai.com';
    });

    // ===== Watch =====
    watch(prefillCOTSetting, function (val) {
      localStorage.setItem('huanhuan_prefillCOT', val);
    });

    let autosaveTimer = null;
    let _skipNextAutosave = false;
    watch(
      () => ({ cardForm, results, worldbookEntries: worldbookEntries.value }),
      () => {
        if (currentView.value !== 'create' || !hasCreateContent()) return;
        if (_skipNextAutosave) { _skipNextAutosave = false; return; }
        clearTimeout(autosaveTimer);
        autosaveStatus.value = '保存中...';
        autosaveTimer = setTimeout(() => {
          saveAutoDraft();
          autosaveAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          autosaveStatus.value = '已自动保存';
        }, 1200);
      },
      { deep: true }
    );

    // ===== Init =====
    // Load user templates on startup
    loadUserTemplates();

    // Setup worldbook watcher
    setupWorldbookWatcher();

    // Setup refine global handlers
    setupRefineGlobalHandlers();

    onMounted(() => {
      checkAuth();
      loadDrafts();
      const hash = window.location.hash.replace('#/', '');
      if (hash) currentView.value = hash;

      // Show login error messages from URL params
      const urlParams = new URLSearchParams(window.location.search);
      const loginError = urlParams.get('error');
      if (loginError) {
        const errorMessages = {
          rate_limited: '登录太频繁了，等一两分钟再试',
          oauth_failed: '登录失败，请重试',
          no_code: '登录流程异常，请重新登录',
          not_member: urlParams.get('msg') || '需要加入指定服务器',
          guild_check_failed: urlParams.get('msg') || '服务器验证失败',
          missing_role: urlParams.get('msg') || '缺少所需身份组',
        };
        toast(errorMessages[loginError] || '登录失败：' + loginError, 'error');
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      }

      const autoDraft = loadAutoDraft();
      if (currentView.value === 'create' && autoDraft && autoDraft.timestamp && hasCreateContent() === false) {
        try {
          _skipNextAutosave = true;
          restoreDraft(autoDraft);
          autosaveAt.value = autoDraft.timestamp ? new Date(autoDraft.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
          autosaveStatus.value = '已恢复自动保存';
          toast('已恢复自动保存内容', 'info');
        } catch {}
      }

      window.addEventListener('beforeunload', (e) => {
        if (currentView.value === 'create' && hasCreateContent()) {
          saveAutoDraft();
          e.preventDefault();
          e.returnValue = '';
        }
      });
    });

    // 切换视图时提示保存草稿
    watch(currentView, (v, oldV) => {
      window.location.hash = '#/' + v;
      if (oldV === 'create' && !flags._skipDraftPrompt && hasCreateContent()) {
        const choice = confirm('当前制卡进度未保存，是否保存为草稿？\n\n点击"确定"保存草稿，点击"取消"丢弃。');
        if (choice) {
          saveDraft();
          toast('草稿已保存', 'success');
        }
      }
      flags._skipDraftPrompt = false;
    });

    return {
      user, currentView, apiKeys, cards, toasts,
      keyForm, editingKey, modelList, fetchingModels,
      createStep, generating, generatingCover, finalizing,
      streamOutput, currentGenStep, results, previewTab, editingResult,
      coverPreview, coverBase64, showSuccessModal, successDownloadUrl,
      autosaveStatus, autosaveAt,
      cardForm, steps, stepLabels, toggleExtra,
      avatarUrl, textAIKeys, imageAIKeys, cardCount, hasAnyResult, hasCharacterInput, characterNameList, renderedOutput, namedMvuVariables,
      toast, renderMarkdown, toggleEditResult, providerLabel, providerBadgeClass, baseUrlPlaceholder, formatDate, particleStyle, goToStep, appendExtraReq,
      logout, saveApiKey, editApiKey, cancelEditKey, deleteApiKey, fetchModels,
      generateStep, generateCoverTags, generatingTags, generateCover, uploadCover, importCard, importingCard, importCardToLibrary, importingCardToLibrary, finalizeCard, deleteCard, resetCreateState, generateExtraReq, extraGenDone,
      characterProgress, generateSingleCharacterWB, charWBGenerated, generatingCharWBIndex,
      importedRegexScripts, importedTavernHelperScripts,
      addVariable, removeVariable, loadPresetVariables, clearAllVariables,
      addCharacter, removeCharacter,
      colorDotMap, statusBarSectionOptions, buildStatusBarInput, buildGreetingBeautifyInput,
      /* Worldbook entry editor */
      worldbookEntries, parseWorldbookFromMarkdown, parseWorldbookFromMarkdownSafe, parseXYAMLEntries, syncWorldbookToMarkdown,
      addWorldbookEntry, removeWorldbookEntry, toggleEntryType, updateEntryKeywords, insertEjsCondition, ejsPreviewCode,
      /* 草稿箱 */
      drafts, showDrafts, saveDraft, restoreDraft, deleteDraft, formatDraftTime, hasCreateContent,
      /* 模板编辑器 */
      templateEditor, templateNameMap, templateNames, openTemplateEditor, switchTemplate,
      saveCustomTemplate, resetTemplate, isTemplateCustomized,
      /* Novel import */
      novelImport, handleNovelFile, reDecodeNovel, rechunkNovel,
      startNovelExtract, generateNovelWorldbook,
      /* Card editor */
      editingCardId, editorLoading, editorSaving, editorData, editorEntries,
      editorCoverPreview, editorCoverBase64, editorDescPreview, editorGreetingPreview,
      startEditCard, addEditorEntry, removeEditorEntry, moveEditorEntry,
      uploadEditorCover, saveEditorCard,
      /* Agent chat */
      agentChat, parsePresetJSON, handlePresetUpload, startAgentChat,
      sendAgentMessage, extractAndFinalize, resetAgentChat, renderAgentMessage, escapeHtml,
      /* Prefill COT */
      prefillCOTSetting,
      /* Refine sidebar */
      refineOpen, refineMessages, refineInput, refineSending,
      toggleRefine, sendRefineMessage, applyChange, renderRefineMessage, clearRefineChat,
      /* Regex style customization */
      regexCustomize, regexStylePresets, regexAIStyleOptions, regexAIColorOptions, regexAIElementOptions,
      isRenderableRegex, stripCodeBlock, getRegexPanel,
      toggleRegexStylePanel, toggleRegexAIPanel, toggleRegexSource,
      getRegexSrcdoc, getRegexLiveSrcdoc, updateRegexCSSVar,
      applyRegexCSSChanges, resetRegexCSSChanges, applyRegexPreset,
      toggleRegexAIOption, startRegexAIRewrite, setupRegexIframeResize,
    };
  },
});

app.mount('#app');
