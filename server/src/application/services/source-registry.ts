import { AppError, ValidationError } from '../../domain/errors.js';
import { SOURCE_SPECS, type LinkSourceId, type SourceId } from '../../domain/sources.js';
import type { RemotePack, StickerSourceProvider } from '../ports/sticker-source.port.js';

/** Maximum stickers taken from one pack (Telegram packs hold up to 120, Signal up to 200). */
export const MAX_REMOTE_STICKERS = 200;

/**
 * Directory of sticker sources. Services only talk to the registry and know nothing about
 * each platform's details (Bot API, Signal decryption...).
 */
export class SourceRegistry {
  private readonly providers: Map<LinkSourceId, StickerSourceProvider>;

  constructor(providers: StickerSourceProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  /** Sources for the UI, with an `available` flag (e.g. Telegram needs a bot token). */
  list() {
    return Object.values(SOURCE_SPECS).map((spec) => ({
      ...spec,
      available: spec.input !== 'link' || Boolean(this.providers.get(spec.id as LinkSourceId)?.available()),
    }));
  }

  /** Validates source + link and returns the provider and pack reference. Errors explain what to do. */
  resolve(source: SourceId, input: string): { provider: StickerSourceProvider; ref: string } {
    const spec = SOURCE_SPECS[source];
    const provider = this.providers.get(source as LinkSourceId);
    if (spec.input !== 'link' || !provider) throw new ValidationError(`${spec.label} does not import from links`);
    if (!provider.available()) {
      throw new AppError(`The ${spec.label} source is not configured on the server`, 503, 'SOURCE_UNAVAILABLE');
    }
    const ref = provider.parse(input);
    if (!ref) throw new ValidationError(`Invalid ${spec.label} link. Example: ${spec.examples?.[0] ?? spec.placeholder}`);
    return { provider, ref };
  }

  async fetch(source: SourceId, input: string): Promise<RemotePack> {
    const { provider, ref } = this.resolve(source, input);
    return provider.fetchPack(ref);
  }

  /** Finds a share link of any source in a piece of text (messages sent to the bot). */
  detect(text: string): { source: LinkSourceId; input: string } | null {
    for (const token of text.split(/\s+/)) {
      for (const p of this.providers.values()) {
        if (p.available() && p.parse(token, true)) return { source: p.id, input: token };
      }
    }
    return null;
  }
}
