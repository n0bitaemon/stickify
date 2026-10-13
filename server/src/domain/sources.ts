/**
 * SOURCE platforms – where stickers come from. Each platform shares stickers differently,
 * so each source declares its own kind of input:
 *
 *   - files:   drag-and-drop image/video files (anything the engine reads, ZIPs included)
 *   - link:    paste a pack share link (the server downloads the whole pack)
 *   - archive: upload the platform's packaged file (.wastickers/.zip) or loose sticker files
 *
 * The frontend builds its UI from this list (GET /api/sources) instead of hard-coding it.
 */
export const SOURCE_IDS = ['file', 'telegram', 'signal', 'whatsapp'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** Sources reached through a share link – each has a provider in the infrastructure layer. */
export type LinkSourceId = Extract<SourceId, 'telegram' | 'signal'>;

export type SourceInputKind = 'files' | 'link' | 'archive';

export interface SourceSpec {
  id: SourceId;
  label: string;
  input: SourceInputKind;
  description: string;
  /** For link inputs. */
  placeholder?: string;
  examples?: string[];
  /** For files/archive inputs – the `accept` attribute of <input type=file>. */
  accept?: string;
  /** Steps to get the link/file on the original platform (shown behind a "How to" button). */
  steps: string[];
  notes: string[];
}

export const SOURCE_SPECS: Record<SourceId, SourceSpec> = {
  file: {
    id: 'file',
    label: 'Files',
    input: 'files',
    description: 'Images, animations, vectors or videos from your device.',
    accept: '.png,.jpg,.jpeg,.webp,.gif,.svg,.webm,.mp4,.mov,.tgs,.zip,image/*,video/webm,video/mp4',
    steps: ['Drag files onto the drop zone or click it to browse.', 'ZIP files are unpacked automatically.', 'Review the stickers, untick any you do not want, then continue.'],
    notes: ['PNG, JPG, WebP, SVG, GIF, APNG, WebM, MP4, MOV, TGS – up to 20MB per file.'],
  },
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    input: 'link',
    description: 'Paste a sticker pack link – Stickify downloads the whole pack through the Telegram Bot API.',
    placeholder: 'https://t.me/addstickers/PackName',
    examples: ['https://t.me/addstickers/deathclickk', 't.me/addemoji/EmojiPackName'],
    steps: [
      'In Telegram, open any sticker from the pack and tap the pack name at the top of the sticker panel.',
      'Tap ⋯ (or the share icon) → Copy Link.',
      'Paste the link here. Once your account is linked you can also forward stickers to the bot.',
    ],
    notes: ['Supports static (WebP), video (WebM) and custom emoji packs.', 'Lottie (.tgs) stickers can only be exported back to Telegram.'],
  },
  signal: {
    id: 'signal',
    label: 'Signal',
    input: 'link',
    description: 'Paste a signal.art link – Stickify downloads and decrypts the pack from Signal\'s CDN.',
    placeholder: 'https://signal.art/addstickers/#pack_id=…&pack_key=…',
    examples: [
      'https://signal.art/addstickers/#pack_id=9acc9e8aba563d26a4994e69263e3b25&pack_key=5a6dff3948c28efb9b7aaf93ecc375c69fc316e78077ed26867a14d10a0f6a12',
    ],
    steps: [
      'In Signal, open the sticker panel and long-press the pack (or use ⋯ on Desktop).',
      'Choose Share → Copy link (it looks like signal.art/addstickers/#pack_id=…).',
      'Paste the whole link here – it contains the decryption key.',
    ],
    notes: ['Supports static (WebP/PNG) and animated (APNG) stickers.'],
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    input: 'archive',
    description: 'WhatsApp has no pack share links – use a .wastickers/.zip export or .webp files.',
    accept: '.wastickers,.zip,.webp,image/webp,application/zip',
    steps: [
      'Packs made with a sticker maker app: use its Export option to get a .wastickers or .zip file.',
      'Stickers received in chats (Android): copy the .webp files from WhatsApp/Media/WhatsApp Stickers.',
      'Drop those files here – pack name, author and emojis are read from contents.json/title.txt when present.',
    ],
    notes: ['Supports static and animated WebP.'],
  },
};

export const isSourceId = (v: unknown): v is SourceId => typeof v === 'string' && (SOURCE_IDS as readonly string[]).includes(v);
