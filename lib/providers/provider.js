// Provider interface. Every generation backend implements these methods so
// another provider can be added later without touching the routes or UI.
//
// Shared shapes (JSDoc only; the project is plain JS):
//
// @typedef {object} MediaInput
// @property {string} assetId
// @property {string} mimeType
// @property {() => Promise<ArrayBuffer>} load        bytes from R2
// @property {string|null} [cachedUri]                 provider-side copy, if any
// @property {number|null} [cachedUriExpiresAt]        ms epoch
// @property {(uri: string, expiresAt: number|null) => Promise<void>} [onUploaded]
//
// @typedef {object} ProviderOutput
// @property {'image'|'video'|'audio'} kind
// @property {string} mimeType
// @property {string} [data]   base64 (inline delivery)
// @property {string} [uri]    provider file URI (uri delivery)
//
// @typedef {object} JobResult
// @property {string} jobId               provider job / interaction id
// @property {'running'|'completed'|'failed'} status
// @property {ProviderOutput[]} [outputs]
// @property {string} [error]
// @property {object} [usage]
//
// Methods:
//   generateImage({ model, prompt, media: MediaInput[], aspectRatio, imageSize }) -> JobResult
//   generateVideo({ model, prompt, media: MediaInput[], aspectRatio, resolution, durationSeconds }) -> JobResult
//   editVideo({ model, previousJobId, prompt, aspectRatio, resolution }) -> JobResult
//   extendVideo({ model, previousJobId, prompt, media, aspectRatio, resolution, durationSeconds }) -> JobResult
//   designVoice({ name, description, languageCode }) -> { voiceId, expiresAt }
//   generateSpeech({ model, voiceId, text, style }) -> JobResult (audio output)
//   getStatus(jobId) -> JobResult
//   fetchOutput(output: ProviderOutput) -> { body: ReadableStream|ArrayBuffer|Uint8Array, mimeType, size: number|null }

export class ProviderError extends Error {
  constructor(message, { status = 500, details = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.details = details;
  }
}

export class Provider {
  /** @returns {string} */
  get id() {
    throw new Error('not implemented');
  }

  async generateImage() {
    throw new ProviderError(`${this.id} cannot generate images`, { status: 400 });
  }

  async generateVideo() {
    throw new ProviderError(`${this.id} cannot generate videos`, { status: 400 });
  }

  async editVideo() {
    throw new ProviderError(`${this.id} cannot edit videos`, { status: 400 });
  }

  async extendVideo() {
    throw new ProviderError(`${this.id} cannot extend videos`, { status: 400 });
  }

  async designVoice() {
    throw new ProviderError(`${this.id} cannot design voices`, { status: 400 });
  }

  async generateSpeech() {
    throw new ProviderError(`${this.id} cannot generate speech`, { status: 400 });
  }

  async getStatus() {
    throw new ProviderError(`${this.id} has no job status`, { status: 400 });
  }

  async fetchOutput() {
    throw new ProviderError(`${this.id} cannot fetch outputs`, { status: 400 });
  }
}
