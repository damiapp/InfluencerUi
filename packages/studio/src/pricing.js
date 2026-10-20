// Cost estimation shared by the browser (shown before generating) and the
// server (stored on each generation). The price table itself lives in
// config/pricing.json and is served by /api/stats.

function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * @param {object} pricing  contents of config/pricing.json
 * @param {object} request
 * @param {'image'|'video'|'audio'|'text'} request.kind
 * @param {string} request.model
 * @param {string} [request.imageSize]        image: 1K/2K/4K
 * @param {number} [request.count]            image: number of images
 * @param {string} [request.resolution]       video: 720p/1080p/...
 * @param {number} [request.durationSeconds]  video/audio: seconds of output
 * @param {number} [request.inputImages]      reference images + frames sent
 * @returns {number|null} USD estimate, or null if the model has no price
 */
export function estimateCost(pricing, request) {
  if (!pricing || !request) return null;
  const inputImages = Math.max(0, request.inputImages || 0);

  if (request.kind === 'image') {
    const table = pricing.image?.[request.model];
    if (!table) return null;
    const perImage = table.perImage?.[request.imageSize || '1K'] ?? table.perImage?.['1K'];
    if (perImage == null) return null;
    const count = Math.max(1, request.count || 1);
    return round(count * (perImage + inputImages * (table.inputImage || 0)));
  }

  if (request.kind === 'video') {
    const table = pricing.video?.[request.model];
    if (!table) return null;
    const perSecond = table.perSecond?.[request.resolution || '720p'];
    if (perSecond == null) return null;
    const seconds = Math.max(0, request.durationSeconds || 0);
    return round(seconds * perSecond + inputImages * (table.inputImage || 0));
  }

  if (request.kind === 'text') {
    const table = pricing.text?.[request.model];
    if (!table) return null;
    const input = (request.inputTokens || 0) + inputImages * (table.tokensPerImage || 0);
    const output = request.outputTokens ?? table.typicalOutputTokens ?? 0;
    return round((input * table.inputPerMillion + output * table.outputPerMillion) / 1e6);
  }

  if (request.kind === 'audio') {
    const table = pricing.audio?.[request.model];
    if (!table) return null;
    return round(Math.max(0, request.durationSeconds || 0) * table.perSecond);
  }

  return null;
}

/** Exact cost of a text call from the usage block Google returns, if priced. */
export function textCostFromUsage(pricing, model, usage) {
  const table = pricing?.text?.[model];
  if (!table || !usage) return null;
  const input = usage.total_input_tokens || 0;
  const output = (usage.total_output_tokens || 0) + (usage.total_thought_tokens || 0);
  if (!input && !output) return null;
  return round((input * table.inputPerMillion + output * table.outputPerMillion) / 1e6);
}

export function formatCost(value, currency = 'USD') {
  if (value == null || Number.isNaN(value)) return '—';
  const digits = value < 1 ? 3 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `$${value.toFixed(digits)}`;
  }
}
