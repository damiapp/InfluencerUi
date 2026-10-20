// Reference library helpers shared by the browser (preview of what will be
// sent) and the server (pipeline runs). A character has up to 20 tagged
// references; each request sends the best subset within the model's limit.

export const MAX_CHARACTER_REFS = 20;
export const RECOMMENDED_CHARACTER_REFS = 10;
export const MAX_PRIMARY_REFS = 3;

export const ANGLES = [
  { value: 'front', label: 'Front' },
  { value: 'three-quarter', label: '¾' },
  { value: 'profile', label: 'Profile' },
  { value: 'full-body', label: 'Full body' },
];

export const LIGHTINGS = ['soft daylight', 'hard sun', 'golden hour', 'overcast', 'studio', 'indoor warm', 'night', 'flash'];

export const EXPRESSIONS = ['neutral', 'soft smile', 'big smile', 'laughing', 'serious', 'surprised', 'pout', 'eyes closed'];

const norm = (value) => (value || '').trim().toLowerCase() || null;

/**
 * Pick up to `budget` references: primaries first (in library order), then
 * fill greedily with the reference that adds the most variety — a new
 * angle counts most, then a new expression, then new lighting. Untagged
 * references rank after tagged ones of an already-covered angle. Ties keep
 * library order.
 *
 * @param {Array<{id: string, angle?: string, expression?: string, lighting?: string, primary?: boolean}>} refs
 * @param {number} budget
 * @param {{ exclude?: string[] }} [options]
 */
export function selectRefs(refs, budget, { exclude = [] } = {}) {
  if (!Array.isArray(refs) || budget <= 0) return [];
  const pool = refs.filter((r) => r && !exclude.includes(r.id));
  const selected = pool.filter((r) => r.primary).slice(0, Math.min(budget, MAX_PRIMARY_REFS));
  const rest = pool.filter((r) => !selected.includes(r));

  const covered = { angle: new Map(), expression: new Set(), lighting: new Set() };
  const take = (ref) => {
    const angle = norm(ref.angle);
    if (angle) covered.angle.set(angle, (covered.angle.get(angle) || 0) + 1);
    if (norm(ref.expression)) covered.expression.add(norm(ref.expression));
    if (norm(ref.lighting)) covered.lighting.add(norm(ref.lighting));
  };
  selected.forEach(take);

  while (selected.length < budget && rest.length) {
    let best = 0;
    let bestScore = -Infinity;
    rest.forEach((ref, index) => {
      const angle = norm(ref.angle);
      let score = 0;
      if (angle) score += covered.angle.has(angle) ? -covered.angle.get(angle) : 8;
      else score -= 0.5;
      if (norm(ref.expression) && !covered.expression.has(norm(ref.expression))) score += 2;
      if (norm(ref.lighting) && !covered.lighting.has(norm(ref.lighting))) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    const [ref] = rest.splice(best, 1);
    selected.push(ref);
    take(ref);
  }
  return selected;
}

/** The first `count` primary refs, falling back to the best varied refs. */
export function primaryRefs(refs, count) {
  const primaries = (refs || []).filter((r) => r.primary).slice(0, count);
  if (primaries.length >= count) return primaries;
  return selectRefs(refs, count);
}

export function describeRef(ref) {
  const angle = ANGLES.find((a) => a.value === ref.angle)?.label;
  return [angle, ref.expression, ref.lighting].filter(Boolean).join(' · ') || 'untagged';
}

/** Structured-output schema for auto-tagging references with the text model. */
export const TAGS_SCHEMA = {
  type: 'object',
  properties: {
    refs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          angle: { type: 'string', enum: ANGLES.map((a) => a.value) },
          expression: { type: 'string', enum: EXPRESSIONS },
          lighting: { type: 'string', enum: LIGHTINGS },
        },
        required: ['index', 'angle', 'expression', 'lighting'],
      },
    },
  },
  required: ['refs'],
};

export function tagInstructions(count) {
  return [
    `Tag each of the ${count} reference photos above, in order (index 0 is the first image).`,
    '- angle: front (facing the camera), three-quarter, profile (side view) or full-body (most of the body visible).',
    '- expression: the closest of the allowed values.',
    '- lighting: the closest of the allowed values.',
    'Describe only what is visible. Do not identify or name the person.',
  ].join('\n');
}
