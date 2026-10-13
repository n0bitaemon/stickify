import type { OutputFormat } from './media.js';

/**
 * Sticker specs for every TARGET platform – the single source of truth for the processing
 * engine, validators and the UI (the frontend reads this list from GET /api/platforms).
 *
 * Limits follow each platform's official documentation at the time of writing; when a
 * platform changes its rules, only this file needs to change. Where a platform publishes
 * no limit we use a conservative value and say so in `notes`.
 */
export const PLATFORM_IDS = ['telegram', 'whatsapp', 'imessage', 'signal', 'discord', 'viber', 'facebook'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface StaticRule {
  format: Extract<OutputFormat, 'webp' | 'png'>;
  maxBytes: number;
}

export interface AnimatedRule {
  format: Extract<OutputFormat, 'webp' | 'webm' | 'apng' | 'gif'>;
  maxBytes: number;
  maxDurationMs: number;
  maxFps: number;
}

export interface TrayRule {
  width: number;
  height: number;
  format: 'png' | 'webp';
  maxBytes: number;
}

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  /** Target canvas (the sticker is centred and padded with transparency to fill it). */
  canvas: { width: number; height: number };
  static: StaticRule;
  /** null = the platform has no animated stickers → the first frame is exported as a still. */
  animated: AnimatedRule | null;
  /** Pack icon (tray icon), when the platform requires one. */
  tray: TrayRule | null;
  /** splitByAnimation: the platform forbids mixing static and animated stickers in one pack. */
  pack: { min: number; max: number; splitByAnimation?: boolean };
  /** Accepts original Telegram .tgs (Lottie) files without rendering. */
  acceptsLottie: boolean;
  /** Can be pushed straight to the platform through an API (only Telegram's Bot API). */
  directPublish: boolean;
  notes: string[];
  /** How to add the exported files to this platform – shown in the UI and the ZIP's README. */
  importGuide: string[];
}

const KB = 1024;

export const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    canvas: { width: 512, height: 512 },
    static: { format: 'webp', maxBytes: 512 * KB },
    animated: { format: 'webm', maxBytes: 256 * KB, maxDurationMs: 3000, maxFps: 30 },
    tray: { width: 100, height: 100, format: 'webp', maxBytes: 32 * KB },
    pack: { min: 1, max: 120 },
    acceptsLottie: true,
    directPublish: true,
    notes: [
      'Animated stickers are exported as WebM VP9 video stickers: no audio, at most 3 seconds.',
      'Can be pushed straight to Telegram through the bot once your account is linked.',
    ],
    importGuide: [
      'Easiest: link your Telegram account on the Telegram page, then use "Push to Telegram" – Stickify creates the pack for you.',
      'Manually: open @Stickers in Telegram and send /newpack (static .webp) or /newvideo (video .webm).',
      'Send the pack name, then each sticker file from the ZIP followed by its emoji (see manifest.json).',
      'Send /publish, pick an icon (tray.webp) and choose a short link name.',
    ],
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    canvas: { width: 512, height: 512 },
    static: { format: 'webp', maxBytes: 100 * KB },
    animated: { format: 'webp', maxBytes: 500 * KB, maxDurationMs: 10_000, maxFps: 15 },
    tray: { width: 96, height: 96, format: 'png', maxBytes: 50 * KB },
    pack: { min: 3, max: 30, splitByAnimation: true },
    acceptsLottie: false,
    directPublish: false,
    notes: [
      '3–30 stickers per pack, no mixing of static and animated – Stickify splits into sub-packs when needed.',
      'The ZIP contains one ready-to-import .wastickers file per pack.',
    ],
    importGuide: [
      'WhatsApp cannot import sticker files directly – you need a sticker importer app.',
      'Android: install an app that opens .wastickers files (e.g. "Personal Stickers for WhatsApp").',
      'iPhone: install a sticker maker app that supports importing images (e.g. "Sticker Maker Studio").',
      'Unzip the download, open the .wastickers file (or the images) with the app, then tap "Add to WhatsApp".',
    ],
  },
  imessage: {
    id: 'imessage',
    label: 'Apple iMessage',
    canvas: { width: 408, height: 408 },
    static: { format: 'png', maxBytes: 500 * KB },
    animated: { format: 'apng', maxBytes: 500 * KB, maxDurationMs: 5000, maxFps: 15 },
    tray: null,
    pack: { min: 1, max: 200 },
    acceptsLottie: false,
    directPublish: false,
    notes: ['"Regular" size 408×408 – import the files into an Xcode Sticker Pack.'],
    importGuide: [
      'iMessage stickers ship as an app: you need a Mac with Xcode and an Apple Developer account to publish.',
      'In Xcode: File → New → Project → iOS → Sticker Pack App.',
      'Open Stickers.xcstickers → Sticker Pack and drag in the PNG files from the ZIP.',
      'Set Sticker Size to "Regular", add an app icon, then run on your iPhone or submit to the App Store.',
    ],
  },
  signal: {
    id: 'signal',
    label: 'Signal',
    canvas: { width: 512, height: 512 },
    static: { format: 'webp', maxBytes: 300 * KB },
    animated: { format: 'apng', maxBytes: 300 * KB, maxDurationMs: 3000, maxFps: 15 },
    tray: null,
    pack: { min: 1, max: 200 },
    acceptsLottie: false,
    directPublish: false,
    notes: ['The 3-second limit is a conservative choice to stay under 300KB.'],
    importGuide: [
      'Open Signal Desktop (the phone apps cannot create packs).',
      'Choose File → Create/upload sticker pack.',
      'Drag in the files from the ZIP, assign an emoji to each sticker (see manifest.json).',
      'Enter a title and author, then Upload – Signal gives you a link to share the pack.',
    ],
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    canvas: { width: 320, height: 320 },
    static: { format: 'png', maxBytes: 512 * KB },
    animated: { format: 'apng', maxBytes: 512 * KB, maxDurationMs: 5000, maxFps: 15 },
    tray: null,
    pack: { min: 1, max: 60 },
    acceptsLottie: false,
    directPublish: false,
    notes: ['The number of sticker slots depends on the server\'s Boost level.'],
    importGuide: [
      'You need the "Manage Expressions" permission on the server.',
      'Open Server Settings → Stickers → Upload Sticker.',
      'Pick a file from the ZIP, give it a name and a related emoji, then Upload.',
      'Repeat for each sticker – free servers have a handful of slots, boosting unlocks more.',
    ],
  },
  viber: {
    id: 'viber',
    label: 'Viber',
    canvas: { width: 490, height: 490 },
    static: { format: 'png', maxBytes: 1024 * KB },
    animated: null,
    tray: null,
    pack: { min: 1, max: 24 },
    acceptsLottie: false,
    directPublish: false,
    notes: ['Viber Sticker Creator only accepts static PNG – animated stickers use their first frame.'],
    importGuide: [
      'Open Viber\'s Sticker Creator on the web (create.viber.com) and sign in with your Viber number.',
      'Create a new sticker pack and give it a name.',
      'Upload the PNG files from the ZIP (up to 24 per pack).',
      'Submit the pack – it appears in your Viber sticker market once approved.',
    ],
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Messenger',
    canvas: { width: 512, height: 512 },
    static: { format: 'png', maxBytes: 1024 * KB },
    animated: { format: 'gif', maxBytes: 2048 * KB, maxDurationMs: 10_000, maxFps: 15 },
    tray: null,
    pack: { min: 1, max: 200 },
    acceptsLottie: false,
    directPublish: false,
    notes: ['Messenger does not support custom sticker packs – the files are meant to be sent as images/GIFs.'],
    importGuide: [
      'Messenger has no custom sticker packs, so the stickers are sent as transparent images.',
      'Save the PNG/GIF files from the ZIP to your phone\'s gallery.',
      'In a chat, tap the photo icon and send the sticker – transparency is kept.',
    ],
  },
};

export const isPlatformId = (v: unknown): v is PlatformId =>
  typeof v === 'string' && (PLATFORM_IDS as readonly string[]).includes(v);

export const getPlatformSpec = (id: PlatformId): PlatformSpec => PLATFORM_SPECS[id];
