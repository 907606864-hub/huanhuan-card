/**
 * Image generation service
 * Supports: NovelAI, custom endpoints
 */

async function generateImage({ provider, apiKey, baseUrl, prompt, extraConfig }) {
  switch (provider) {
    case 'novelai':
      return generateNovelAIImage({ apiKey, baseUrl, prompt, extraConfig });
    case 'custom':
      return generateCustomImage({ apiKey, baseUrl, prompt, extraConfig });
    default:
      throw new Error(`不支持的图片生成服务: ${provider}`);
  }
}

// NovelAI — aligned with fzsmphone v4.5 format
async function generateNovelAIImage({ apiKey, baseUrl, prompt, extraConfig }) {
  // Build URL: support custom base URL (e.g. proxy), default to official endpoint
  let url;
  if (baseUrl && baseUrl.trim()) {
    let u = baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    // Strip known suffixes to normalize
    u = u.replace(/\/ai\/generate-image$/i, '').replace(/\/ai$/i, '').replace(/\/+$/, '');
    url = `${u}/ai/generate-image`;
  } else {
    url = 'https://image.novelai.net/ai/generate-image';
  }

  const model = extraConfig?.model || 'nai-diffusion-4-5-full';
  const isV45 = model.includes('nai-diffusion-4-5');
  const width = extraConfig?.width || (isV45 ? 1024 : 832);
  const height = extraConfig?.height || (isV45 ? 1024 : 1216);
  const cfg = extraConfig?.scale || extraConfig?.cfg || 5;
  const steps = extraConfig?.steps || 28;
  const sampler = extraConfig?.sampler || 'k_euler';
  const scheduler = extraConfig?.scheduler || 'karras';
  const seed = Math.floor(Math.random() * 4294967295);
  const negPrompt = extraConfig?.negativePrompt || '';

  const parameters = {
    params_version: 3,
    width,
    height,
    scale: cfg,
    seed,
    sampler,
    noise_schedule: scheduler,
    steps,
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    autoSmea: false,
    cfg_rescale: 0,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    legacy_v3_extend: false,
    use_coords: false,
    legacy_uc: false,
    normalize_reference_strength_multiple: true,
    inpaintImg2ImgStrength: 1,
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
    image_format: 'png',
    skip_cfg_above_sigma: null,
    sm: false,
    sm_dyn: false,
    characterPrompts: [],
    v4_prompt: {
      caption: { base_caption: prompt || '', char_captions: [] },
      use_coords: false,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: negPrompt, char_captions: [] },
      legacy_uc: false,
    },
    negative_prompt: negPrompt,
    ...(extraConfig?.parameters || {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/zip, image/png, image/jpeg',
      'User-Agent': 'HuanhuanCard/1.0',
    },
    body: JSON.stringify({
      input: prompt,
      model,
      action: 'generate',
      parameters,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NovelAI API error ${res.status}: ${text}`);
  }

  // NovelAI returns a zip file with the image
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  // Check if it's a ZIP (PK header)
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) {
    // Parse ZIP local file header
    const compressionMethod = buf.readUInt16LE(8);
    const fileNameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const dataStart = 30 + fileNameLen + extraLen;

    if (compressionMethod === 0) {
      // Stored — find PNG/JPEG signature directly
      const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const pngStart = buf.indexOf(pngSig, dataStart);
      if (pngStart !== -1) return buf.subarray(pngStart);
      const jpegStart = buf.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]), dataStart);
      if (jpegStart !== -1) return buf.subarray(jpegStart);
    } else if (compressionMethod === 8) {
      // Deflate — need to decompress
      // Find the next PK header or data descriptor to determine compressed data end
      let compEnd = buf.length;
      // Look for next PK signature or data descriptor (0x08074b50)
      for (let i = dataStart + 1; i < buf.length - 3; i++) {
        if (buf[i] === 0x50 && buf[i+1] === 0x4B && (buf[i+2] === 0x03 || buf[i+2] === 0x01 || buf[i+2] === 0x05)) {
          compEnd = i;
          break;
        }
        // Data descriptor signature
        if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x07 && buf[i+3] === 0x08) {
          compEnd = i;
          break;
        }
      }

      const zlib = require('zlib');
      const compressedData = buf.subarray(dataStart, compEnd);
      try {
        const decompressed = zlib.inflateRawSync(compressedData);
        return decompressed;
      } catch (e) {
        console.error('[NovelAI] Deflate failed, trying full buffer:', e.message);
        // Try with more data (some ZIPs have trailing content)
        try {
          const decompressed = zlib.inflateRawSync(buf.subarray(dataStart));
          return decompressed;
        } catch (e2) {
          throw new Error('NovelAI ZIP 解压失败: ' + e2.message);
        }
      }
    }
  }

  // Not a ZIP — try raw image signatures
  const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
  const pngStart = buf.indexOf(pngSig);
  if (pngStart !== -1) return buf.subarray(pngStart);
  
  const jpegStart = buf.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]));
  if (jpegStart !== -1) return buf.subarray(jpegStart);

  // JSON error?
  const text = buf.toString('utf-8').substring(0, 300);
  throw new Error('NovelAI 返回格式无法识别: ' + text);
}

// Custom endpoint
async function generateCustomImage({ apiKey, baseUrl, prompt, extraConfig }) {
  if (!baseUrl) throw new Error('自定义图片 API 需要提供 Base URL');
  
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'HuanhuanCard/1.0',
    },
    body: JSON.stringify({
      prompt,
      ...extraConfig,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Custom image API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  // Try common response formats
  const b64 = data.data?.[0]?.b64_json || data.b64_json || data.image || data.images?.[0];
  if (b64) return Buffer.from(b64, 'base64');

  throw new Error('自定义 API 返回格式不支持');
}

module.exports = { generateImage };
