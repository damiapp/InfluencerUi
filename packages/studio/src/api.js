// Thin client for the app's own server routes. The browser never talks to
// Google directly and never sees the API key.

async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method, headers: {} };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error('Signed out');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function query(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, value === true ? '1' : value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  stats: () => request('/api/stats'),

  listAssets: (params) => request(`/api/assets${query(params)}`).then((d) => d.assets),
  uploadFiles: (files) => {
    const form = new FormData();
    [...files].forEach((file) => form.append('file', file));
    return request('/api/assets', { method: 'POST', form }).then((d) => d.assets);
  },

  listCharacters: () => request('/api/characters').then((d) => d.characters),
  getCharacter: (id) => request(`/api/characters/${id}`).then((d) => d.character),
  createCharacter: (body) => request('/api/characters', { method: 'POST', body }).then((d) => d.character),
  updateCharacter: (id, body) => request(`/api/characters/${id}`, { method: 'PATCH', body }).then((d) => d.character),
  deleteCharacter: (id) => request(`/api/characters/${id}`, { method: 'DELETE' }),
  addCharacterRef: (id, assetId) => request(`/api/characters/${id}/refs`, { method: 'POST', body: { assetId } }).then((d) => d.character),
  designVoice: (id, voiceDescription) =>
    request(`/api/characters/${id}/voice`, { method: 'POST', body: { voiceDescription } }).then((d) => d.character),
  generateSpeech: (body) => request('/api/generations/speech', { method: 'POST', body }).then((d) => d.generation),
  saveVoiceover: (clipId, { blob, speechGenerationId, mix }) => {
    const form = new FormData();
    form.append('file', new File([blob], 'voiceover.mp4', { type: 'video/mp4' }));
    form.append('speechGenerationId', speechGenerationId);
    form.append('mix', JSON.stringify(mix));
    return request(`/api/generations/${clipId}/voiceover`, { method: 'POST', form }).then((d) => d.generation);
  },

  listGenerations: (params) => request(`/api/generations${query(params)}`).then((d) => d.generations),
  getGeneration: (id) => request(`/api/generations/${id}`).then((d) => d.generation),
  setFavorite: (id, favorite) => request(`/api/generations/${id}`, { method: 'PATCH', body: { favorite } }).then((d) => d.generation),
  generateImage: (body) => request('/api/generations/image', { method: 'POST', body }).then((d) => d.generations),
  generateVideo: (body) => request('/api/generations/video', { method: 'POST', body }).then((d) => d.generation),
  sweep: () => request('/api/generations/sweep', { method: 'POST' }),

  logout: () => request('/api/auth/logout', { method: 'POST' }),
};
