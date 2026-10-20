// Cost estimation shared by the browser (shown before generating) and the
// server (stored on each generation). The price table itself lives in
// config/pricing.json and is served by /api/stats.

function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * @param {object} pricing  contents of config/pricing.json
 * @param {object} request
 * @param {'image'|'video'} request.kind
 * @param {string} request.model
 * @param {string} [request.imageSize]        image: 1K/2K/4K
 * @param {number} [request.count]            image: number of images
 * @param {string} [request.resolution]       video: 720p/1080p/...
 * @param {number} [request.durationSeconds]  video: seconds of output
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

  return null;
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
