// state.js - All shared reactive state
const { ref, reactive, computed, watch } = Vue;

// ===== Core State =====
export const user = reactive({ loggedIn: false, user: null, userId: null });
export const currentView = ref('dashboard');
export const apiKeys = ref([]);
export const cards = ref([]);
export const toasts = ref([]);

// Key form
export const keyForm = reactive({ provider: '', label: '', apiKey: '', baseUrl: '', model: '', extraConfig: {} });
export const editingKey = ref(null);
export const modelList = ref([]);
export const fetchingModels = ref(false);

// Card creation
export const createStep = ref(0);
export const generating = ref(false);
export const generatingCover = ref(false);
export const finalizing = ref(false);
export const streamOutput = ref('');
export const currentGenStep = ref('');
export const results = reactive({ character: '', worldbook: '', mvu: '', 'mvu-statusbar': '', 'status-bar': '', greeting: '', 'greeting-beautify': '', beautify: '', dialogue: '', interview: '' });
export const previewTab = ref('character');
export const editingResult = ref(null);
export const coverPreview = ref(null);
export const coverBase64 = ref(null);
export const showSuccessModal = ref(false);
export const successDownloadUrl = ref('');
export const characterProgress = ref({ current: 0, total: 0, charName: '' });
export const autosaveStatus = ref('');
export const autosaveAt = ref('');

// Worldbook entry editor
export const worldbookEntries = ref([]);

// 草稿箱
export const drafts = ref([]);
export const showDrafts = ref(false);
export const DRAFTS_KEY = 'huanhuan-card-drafts';
export const AUTOSAVE_KEY = 'huanhuan-card-autosave';

// 模板编辑器
export const TEMPLATES_KEY = 'huanhuan-card-templates';
export const templateEditor = reactive({
  show: false,
  templates: {},
  currentName: '',
  currentContent: '',
  loading: false,
});
export const templateNameMap = {
  'character': '角色设定',
  'worldbook': '世界书',
  'greeting': '开场白',
  'greeting-beautify': '开场白美化',
  'greeting-beautify-mvu': '开场白美化(MVU)',
  'mvu': 'MVU 变量系统',
  'mvu-statusbar': 'MVU 状态栏',
  'status-bar': '状态栏',
  'dialogue': '对话示例',
  'interview': '采访问答',
  'extra-requirements': '额外需求补全',
  'player': '玩家设定',
  'novel-extract': '小说提取',
  'ui-beautify': 'UI美化',
  'regex-customize': '正则定制',
};
export const templateNames = Object.keys(templateNameMap);

// Mutable counters (shared via object reference)
export const counters = { wbEntryNextId: 1, editorEntryNextUid: 1 };

// 导入卡片中的正则脚本和酒馆助手脚本
export const importedRegexScripts = ref([]);
export const importedTavernHelperScripts = ref([]);

// Novel import state
export const novelImport = reactive({
  showPanel: false,
  fileName: '',
  fileSize: 0,
  rawBuffer: null,
  encoding: 'auto',
  detectedEncoding: '',
  decodedText: '',
  chapters: [],
  chunks: [],
  maxChunkSize: 50000,
  extracting: false,
  extractDone: false,
  extractProgress: 0,
  extractCurrent: 0,
  extractedCharacters: [],
  extractedWorldSettings: [],
  extractedTimeline: [],
  extractedNpcDynamics: [],
  extractedCausalChains: [],
  error: '',
});

// Card editor state
export const editingCardId = ref(null);
export const editorLoading = ref(false);
export const editorSaving = ref(false);
export const editorData = reactive({
  name: undefined,
  description: '',
  version: 1,
  charDescription: '',
  firstMes: '',
  regexScripts: [],
  tavernHelperScripts: [],
});
export const editorEntries = ref([]);
export const editorCoverPreview = ref(null);
export const editorCoverBase64 = ref(null);
export const editorDescPreview = ref(false);
export const editorGreetingPreview = ref(false);

// Agent chat state
export const agentChat = reactive({
  mode: null,
  presetConfig: null,
  presetName: '',
  messages: [],
  inputText: '',
  sending: false,
  streaming: false,
  cardReady: false,
  extracting: false,
  showSetupModal: true,
});

// Regex Style Customization State
export const regexCustomize = reactive({
  editorPanels: {},
  importPanels: {},
  aiGenerating: false,
  aiStreamOutput: '',
  aiTargetContext: null,
  aiStyles: [],
  aiColors: [],
  aiElements: [],
  aiCustomRequest: '',
});

export const regexStylePresets = {
  '默认': null,
  '赛博朋克': {
    '--sb-primary': '#ff2d95', '--sb-accent': '#00f0ff', '--sb-bg': 'rgba(10, 10, 35, 0.95)',
    '--sb-text': '#e0e0ff', '--sb-text-dim': '#8888cc', '--sb-border': 'rgba(255, 45, 149, 0.3)',
    '--sb-card-bg': 'rgba(20, 10, 40, 0.9)', '--sb-hover': 'rgba(255, 45, 149, 0.15)',
    '--sb-gradient-start': '#ff2d95', '--sb-gradient-end': '#00f0ff',
  },
  '森系清新': {
    '--sb-primary': '#4caf50', '--sb-accent': '#8bc34a', '--sb-bg': 'rgba(245, 240, 230, 0.95)',
    '--sb-text': '#3e4a3e', '--sb-text-dim': '#7a8a7a', '--sb-border': 'rgba(76, 175, 80, 0.2)',
    '--sb-card-bg': 'rgba(255, 255, 250, 0.9)', '--sb-hover': 'rgba(76, 175, 80, 0.1)',
    '--sb-gradient-start': '#4caf50', '--sb-gradient-end': '#8bc34a',
  },
  '暗夜紫金': {
    '--sb-primary': '#9c27b0', '--sb-accent': '#ffd700', '--sb-bg': 'rgba(20, 10, 30, 0.95)',
    '--sb-text': '#e8d5f5', '--sb-text-dim': '#9a7fbf', '--sb-border': 'rgba(156, 39, 176, 0.3)',
    '--sb-card-bg': 'rgba(30, 15, 45, 0.9)', '--sb-hover': 'rgba(255, 215, 0, 0.1)',
    '--sb-gradient-start': '#9c27b0', '--sb-gradient-end': '#ffd700',
  },
  '蒸汽波': {
    '--sb-primary': '#e040fb', '--sb-accent': '#00e5ff', '--sb-bg': 'rgba(25, 10, 40, 0.95)',
    '--sb-text': '#f3e5f5', '--sb-text-dim': '#b39ddb', '--sb-border': 'rgba(224, 64, 251, 0.25)',
    '--sb-card-bg': 'rgba(35, 15, 55, 0.9)', '--sb-hover': 'rgba(224, 64, 251, 0.12)',
    '--sb-gradient-start': '#e040fb', '--sb-gradient-end': '#00e5ff',
  },
  '极简黑白': {
    '--sb-primary': '#9e9e9e', '--sb-accent': '#bdbdbd', '--sb-bg': 'rgba(18, 18, 18, 0.95)',
    '--sb-text': '#e0e0e0', '--sb-text-dim': '#757575', '--sb-border': 'rgba(255, 255, 255, 0.12)',
    '--sb-card-bg': 'rgba(30, 30, 30, 0.9)', '--sb-hover': 'rgba(255, 255, 255, 0.05)',
    '--sb-gradient-start': '#9e9e9e', '--sb-gradient-end': '#616161',
  },
  '樱花': {
    '--sb-primary': '#f48fb1', '--sb-accent': '#f8bbd0', '--sb-bg': 'rgba(255, 245, 248, 0.95)',
    '--sb-text': '#5d3a4a', '--sb-text-dim': '#a07080', '--sb-border': 'rgba(244, 143, 177, 0.25)',
    '--sb-card-bg': 'rgba(255, 250, 252, 0.9)', '--sb-hover': 'rgba(244, 143, 177, 0.1)',
    '--sb-gradient-start': '#f48fb1', '--sb-gradient-end': '#f8bbd0',
  },
  '海洋': {
    '--sb-primary': '#0288d1', '--sb-accent': '#4fc3f7', '--sb-bg': 'rgba(10, 20, 40, 0.95)',
    '--sb-text': '#e1f5fe', '--sb-text-dim': '#80cbc4', '--sb-border': 'rgba(2, 136, 209, 0.25)',
    '--sb-card-bg': 'rgba(15, 25, 50, 0.9)', '--sb-hover': 'rgba(2, 136, 209, 0.12)',
    '--sb-gradient-start': '#0288d1', '--sb-gradient-end': '#4fc3f7',
  },
};

export const regexAIStyleOptions = ['简约', '现代', '赛博朋克', '毛玻璃', '可爱', '华丽', '复古', '酷炫', '像素风', 'RPG游戏'];
export const regexAIColorOptions = ['冷色', '暖色', '霓虹', '马卡龙', '莫兰迪', '暗黑', '渐变'];
export const regexAIElementOptions = ['悬停效果', '入场动效', '粒子效果', '文字发光', '流光', '折叠面板'];

// Prefill COT setting
export const prefillCOTSetting = ref(localStorage.getItem('huanhuan_prefillCOT') || 'auto');

// Refine sidebar state
export const refineOpen = ref(false);
export const refineMessages = ref([]);
export const refineInput = ref('');
export const refineSending = ref(false);

// Extra toggles
export const toggleExtra = reactive({ dialogue: false, interview: false, extra: false });

// Card form
export const cardForm = reactive({
  name: '',
  workType: '',
  aiKeyId: '',
  characterMode: 'simple',
  charNameSimple: '',
  characterInput: '',
  charRole: '', charName: '', charGender: '', charAge: '', charRace: '', charHeight: '',
  charHair: '', charEyes: '', charAppearance: '',
  charOutfitDaily: '', charOutfitSpecial: '', charAccessories: '',
  charPersonality: '', charSpeech: '', charCatchphrase: '', charHabits: '',
  charOccupation: '', charBackstory: '', charRelationships: '',
  charGoals: '', charFears: '', charSkills: '', charNotes: '',
  characters: [
    {
      mode: 'simple',
      nameSimple: '', input: '',
      role: '', name: '', gender: '', age: '', race: '', height: '',
      hair: '', eyes: '', appearance: '',
      outfitDaily: '', outfitSpecial: '', accessories: '',
      personality: '', speech: '', catchphrase: '', habits: '',
      occupation: '', backstory: '', relationships: '',
      goals: '', fears: '', skills: '', notes: '',
    }
  ],
  worldbookMode: 'simple',
  worldbookInput: '',
  bgEra: '', bgLocation: '', bgDescription: '', bgSpecialRules: '', bgNotes: '',
  greetingMode: 'simple',
  openingScene: '', openingLength: '', greetingInput: '',
  openingSpecificScene: '', openingTime: '', openingLocation: '',
  openingAtmosphere: '', openingUserRelation: '', openingInitialConflict: '', openingNotes: '',
  needGreetingBeautify: false,
  greetingBeautifyStyle: '毛玻璃', greetingBeautifyColor: '冷色',
  greetingBeautifyCustomPrimary: '#667eea', greetingBeautifyCustomAccent: '#764ba2',
  greetingBeautifyEffects: ['渐入动画'], greetingBeautifyNotes: '',
  needPlayer: false, playerDepth: '', playerOutline: '',
  needMvu: false, cardType: 'nonmvu',
  needStatusBar: false, statusBarStyle: '毛玻璃', statusBarColor: '冷色',
  statusBarCustomPrimary: '#667eea', statusBarCustomAccent: '#764ba2',
  statusBarSections: ['好感度', '位置', '内心想法'], statusBarCustomSection: '',
  statusBarEffects: ['进度条动画'], statusBarNotes: '',
  mvuComponents: [], mvuVariables: [{ name: '', desc: '' }],
  mvuStageSettings: '', mvuDynamicWorld: '', mvuHtmlDisplay: '', mvuNotes: '', mvuInput: '',
  dialogueCharacter: '', dialogueScenes: '',
  interviewCharacter: '', interviewTopics: '',
  extraCharacter: '',
  extraRequirements: '',
  coverPrompt: '', imageKeyId: '',
});

export const steps = [
  { label: '基本信息' },
  { label: '角色设定' },
  { label: '世界观' },
  { label: '开场白' },
  { label: '玩家角色' },
  { label: '变量/状态栏' },
  { label: '额外选项' },
  { label: '封面打包' },
];

export const stepLabels = {
  character: '角色设定',
  worldbook: '世界书',
  mvu: 'MVU 变量',
  'mvu-statusbar': 'MVU 状态栏',
  'status-bar': '状态栏',
  greeting: '开场白',
  'greeting-beautify': '开场白美化',
  beautify: '美化',
  dialogue: '对话样本',
  interview: '角色深访',
  'extra-requirements': '补充设定',
};

// Multi-character worldbook generation
export const charWBGenerated = reactive({});
export const generatingCharWBIndex = ref(-1);

export const extraGenDone = reactive({ dialogue: false, interview: false, 'extra-requirements': false });

export const generatingTags = ref(false);
export const importingCard = ref(false);
export const importingCardToLibrary = ref(false);

// Status bar helpers
export const colorDotMap = {
  '冷色': '#667eea', '暖色': '#f6a623', '莫兰迪': '#b8a9c9',
  '霓虹': '#39ff14', '森系': '#4a7c59', '樱花': '#ffb7c5', '自定义': '#888',
};

export const statusBarSectionOptions = [
  { label: '日期时间', value: '日期时间' },
  { label: '位置', value: '位置' },
  { label: '好感度', value: '好感度' },
  { label: '着装', value: '着装' },
  { label: '内心想法', value: '内心想法' },
  { label: '关系状态', value: '关系状态' },
  { label: '自定义', value: '自定义' },
];

// Mutable flag for draft prompt skip
export const flags = { _skipDraftPrompt: false };
