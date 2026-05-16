/**
 * SillyTavern Preset Parser
 * Parses SillyTavern preset JSON into systemPrompt, pipelineSteps, and modelParams.
 */

function parsePreset(presetJSON) {
  const prompts = presetJSON.prompts || [];

  /* Layer 1: Filter out markers and empty entries, extract model params */
  const validPrompts = prompts.filter(function (p) {
    if (p.marker) return false;
    if (!p.content || !p.content.trim()) return false;
    return true;
  });

  /* Extract model parameters from top-level fields */
  const modelParamKeys = [
    'temperature', 'max_tokens', 'top_p', 'top_k',
    'frequency_penalty', 'presence_penalty', 'repetition_penalty'
  ];
  var modelParams = {};
  modelParamKeys.forEach(function (key) {
    if (presetJSON[key] !== undefined && presetJSON[key] !== null) {
      modelParams[key] = presetJSON[key];
    }
  });

  /* Layer 2: Classify into enabled (always-on) and disabled (pipeline steps) */
  var enabledPrompts = validPrompts.filter(function (p) { return p.enabled; });
  var disabledPrompts = validPrompts.filter(function (p) { return !p.enabled; });

  /* Layer 3: Assemble */
  var systemPrompt = enabledPrompts
    .map(function (p) { return p.content.trim(); })
    .join('\n\n');

  var pipelineSteps = disabledPrompts.map(function (p) {
    return {
      name: p.name || p.identifier || '',
      content: p.content.trim(),
      role: p.role || 'system',
    };
  });

  return { systemPrompt: systemPrompt, pipelineSteps: pipelineSteps, modelParams: modelParams };
}

module.exports = { parsePreset };
