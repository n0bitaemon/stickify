import crypto from 'node:crypto';
import type { RemotePack, StickerSourceProvider } from '../../application/ports/sticker-source.port.js';
import { MediaError } from '../../domain/errors.js';
import { httpsGet } from './https-get.js';
import { SIGNAL_CA } from './signal-ca.js';

const CDN = 'https://cdn.signal.org/stickers';

/** AES + HMAC keys derived from the pack_key with HKDF-SHA256 (same as Signal-Desktop). */
function deriveKeys(packKeyHex: string) {
  const okm = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(packKeyHex, 'hex'), Buffer.alloc(32), Buffer.from('Sticker Pack'), 64));
  return { aesKey: okm.subarray(0, 32), macKey: okm.subarray(32) };
}

/**
 * Encrypted CDN file layout: IV(16) ‖ AES-256-CBC(PKCS7) ‖ HMAC-SHA256(32) over IV‖ciphertext.
 * The MAC is checked before decrypting: a wrong key or tampered data is rejected.
 */
export function decryptSignalBlob(blob: Buffer, keys: { aesKey: Buffer; macKey: Buffer }): Buffer {
  if (blob.length < 16 + 16 + 32) throw new MediaError('Invalid Signal data');
  const body = blob.subarray(0, blob.length - 32);
  const mac = blob.subarray(blob.length - 32);
  const expected = crypto.createHmac('sha256', keys.macKey).update(body).digest();
  if (!crypto.timingSafeEqual(expected, mac)) throw new MediaError('Could not decrypt the Signal pack – the pack_key in the link is wrong');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keys.aesKey, body.subarray(0, 16));
  return Buffer.concat([decipher.update(body.subarray(16)), decipher.final()]);
}

type ProtoField = [field: number, value: number | Buffer];

/** Minimal protobuf decoder (varint + length-delimited) – enough for the sticker manifest. */
function decodeProto(buf: Buffer): ProtoField[] {
  const out: ProtoField[] = [];
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (i >= buf.length) throw new MediaError('Corrupt Signal manifest');
      byte = buf[i++]!;
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  };
  while (i < buf.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) out.push([field, varint()]);
    else if (wire === 2) {
      const len = varint();
      out.push([field, buf.subarray(i, i + len)]);
      i += len;
    } else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else throw new MediaError('The Signal manifest uses an unsupported field type');
  }
  return out;
}

const str = (v: number | Buffer | undefined) => (Buffer.isBuffer(v) ? v.toString('utf8') : '');

/**
 * Manifest: Pack { title=1; author=2; cover=3; repeated Sticker stickers=4 }
 *           Sticker { id=1; emoji=2; contentType=3 }
 */
export function parseSignalManifest(buf: Buffer) {
  const pack = decodeProto(buf);
  const stickers = pack
    .filter(([f, v]) => f === 4 && Buffer.isBuffer(v))
    .map(([, v]) => {
      const fields = decodeProto(v as Buffer);
      const get = (n: number) => fields.find(([f]) => f === n)?.[1];
      return { id: Number(get(1) ?? 0), emoji: str(get(2)), contentType: str(get(3)) };
    });
  return { title: str(pack.find(([f]) => f === 1)?.[1]), author: str(pack.find(([f]) => f === 2)?.[1]), stickers };
}

/** Signal source: signal.art/addstickers/#pack_id=…&pack_key=… link → download + decrypt from the CDN. */
export class SignalSource implements StickerSourceProvider {
  readonly id = 'signal' as const;

  available(): boolean {
    return true;
  }

  parse(input: string, strict = false): string | null {
    if (strict && !/signal\.art\/addstickers|sgnl:\/\/addstickers/i.test(input)) return null;
    const id = /pack_id=([0-9a-f]{32})/i.exec(input)?.[1];
    const key = /pack_key=([0-9a-f]{64})/i.exec(input)?.[1];
    return id && key ? `${id.toLowerCase()}:${key.toLowerCase()}` : null;
  }

  async fetchPack(ref: string): Promise<RemotePack> {
    const [packId, packKey] = ref.split(':') as [string, string];
    const keys = deriveKeys(packKey);
    const manifest = parseSignalManifest(decryptSignalBlob(await httpsGet(`${CDN}/${packId}/manifest.proto`, { ca: SIGNAL_CA, maxBytes: 1024 * 1024 }), keys));

    return {
      source: 'signal',
      externalId: packId,
      // The public URL contains the pack_key – it is only returned to the user, never stored.
      url: `https://signal.art/addstickers/#pack_id=${packId}&pack_key=${packKey}`,
      title: manifest.title || 'Signal stickers',
      author: manifest.author,
      counts: { animated: manifest.stickers.filter((s) => s.contentType === 'image/apng').length, video: 0, lottie: 0 },
      stickers: manifest.stickers.map((s) => ({
        filename: `${s.id}.${s.contentType === 'image/apng' ? 'png' : 'webp'}`,
        emojis: s.emoji ? [s.emoji] : [],
        kind: s.contentType === 'image/apng' ? 'animated' : 'static',
        download: async () => decryptSignalBlob(await httpsGet(`${CDN}/${packId}/full/${s.id}`, { ca: SIGNAL_CA }), keys),
      })),
    };
  }
}
