// utils.js - Utility functions
import { toasts } from './state.js';

export function toast(message, type = 'info') {
  const t = { message, type };
  toasts.value.push(t);
  setTimeout(() => {
    const idx = toasts.value.indexOf(t);
    if (idx > -1) toasts.value.splice(idx, 1);
  }, 3000);
}

export function renderMarkdown(text) {
  try { return marked.parse(text); } catch { return text; }
}

export function providerLabel(provider) {
  const map = {
    openai: 'OpenAI 兼容',
    gemini_native: 'Gemini 原生',
    claude_native: 'Claude 原生',
    novelai: 'NovelAI',
    custom_image: '自定义图片',
  };
  return map[provider] || provider;
}

export function providerBadgeClass(provider) {
  var map = {
    openai: 'green',
    gemini_native: 'blue',
    claude_native: 'orange',
    novelai: 'purple',
    custom_image: 'purple',
  };
  return map[provider] || 'default';
}

export function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function particleStyle(n) {
  const size = 4 + Math.random() * 8;
  return {
    width: size + 'px',
    height: size + 'px',
    left: Math.random() * 100 + '%',
    animationDuration: (15 + Math.random() * 25) + 's',
    animationDelay: (Math.random() * 20) + 's',
  };
}

export function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

export function isRenderableRegex(rs) {
  return rs.markdownOnly === true && !rs.promptOnly;
}

export function stripCodeBlock(str) {
  if (!str) return '';
  let s = str.trim();
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n');
    if (firstNewline !== -1) s = s.substring(firstNewline + 1);
    else s = s.substring(3);
  }
  if (s.endsWith('```')) {
    s = s.substring(0, s.length - 3);
  }
  return s.trim();
}

export function wrapCodeBlock(html) {
  return '```\n' + html + '\n```';
}

export function extractCSSVariables(html) {
  const vars = [];
  const seen = new Set();
  const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const name = m[1].trim();
    const value = m[2].trim();
    if (!seen.has(name)) {
      seen.add(name);
      const label = name.replace(/^--(?:sb-)?/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      vars.push({ name, value, label, originalValue: value });
    }
  }
  return vars;
}

export function cn2num(str) {
  const map = { '零':0, '〇':0, '一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9,
                '十':10, '百':100, '千':1000, '万':10000, '亿':100000000 };
  let result = 0, temp = 0, last = 0;
  for (const ch of str) {
    const n = map[ch];
    if (n === undefined) continue;
    if (n >= 10) {
      if (temp === 0) temp = 1;
      if (n === 10000 || n === 100000000) {
        result = (result + temp) * n;
        temp = 0;
      } else {
        temp *= n;
      }
    } else {
      temp += n;
    }
  }
  return result + temp;
}

export function detectEncoding(buffer) {
  const arr = new Uint8Array(buffer);
  if (arr[0] === 0xEF && arr[1] === 0xBB && arr[2] === 0xBF) return 'utf-8';
  if (arr[0] === 0xFF && arr[1] === 0xFE) return 'utf-16le';
  if (arr[0] === 0xFE && arr[1] === 0xFF) return 'utf-16be';

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buffer);
    return 'utf-8';
  } catch (e) {
    return 'gbk';
  }
}

export function decodeBuffer(buffer, encoding) {
  if (encoding === 'auto') {
    encoding = detectEncoding(buffer);
  }
  try {
    const decoder = new TextDecoder(encoding, { fatal: false });
    return decoder.decode(buffer);
  } catch (e) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}
