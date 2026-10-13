import { randomBytes } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors.js';
import { UserModel, type UserDocument } from '../../infrastructure/db/models/user.model.js';
import type { TelegramClient, TgUser } from '../../infrastructure/telegram/telegram.client.js';
import { toObjectId } from './ids.js';

const LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Links a Stickify account to Telegram with a one-time code:
 * the dashboard creates a code → the user opens the deep link t.me/<bot>?start=<code> → the bot confirms.
 * Users never type their Telegram ID and cannot impersonate someone else.
 */
export class TelegramAccountService {
  constructor(private readonly telegram: TelegramClient) {}

  async status(userId: string) {
    const user = await UserModel.findById(toObjectId(userId));
    if (!user) throw new NotFoundError('User');
    let botUsername: string | undefined;
    if (this.telegram.configured) botUsername = (await this.telegram.getMe().catch(() => null))?.username;
    return {
      configured: this.telegram.configured,
      botUsername,
      linked: Boolean(user.telegram?.userId),
      telegramUsername: user.telegram?.username ?? null,
    };
  }

  async createLinkCode(userId: string) {
    const bot = await this.telegram.getMe();
    const code = randomBytes(12).toString('base64url'); // valid for the start parameter (A-Z a-z 0-9 _ -)
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await UserModel.updateOne({ _id: toObjectId(userId) }, { $set: { telegramLinkCode: { code, expiresAt } } });
    return { code, expiresAt, botUsername: bot.username, deepLink: `https://t.me/${bot.username}?start=${code}` };
  }

  /** Called by the bot on /start <code>. */
  async linkByCode(code: string, tgUser: TgUser): Promise<UserDocument> {
    const user = await UserModel.findOne({ 'telegramLinkCode.code': code, 'telegramLinkCode.expiresAt': { $gt: new Date() } });
    if (!user) throw new ValidationError('The link code is wrong or has expired. Create a new one in Stickify.');

    const other = await UserModel.findOne({ 'telegram.userId': tgUser.id, _id: { $ne: user._id } });
    if (other) throw new ConflictError('This Telegram account is already linked to another Stickify account');

    user.set({
      telegram: { userId: tgUser.id, username: tgUser.username, linkedAt: new Date() },
      telegramLinkCode: { code: undefined, expiresAt: undefined },
    });
    return user.save();
  }

  async unlink(userId: string): Promise<void> {
    await UserModel.updateOne({ _id: toObjectId(userId) }, { $unset: { telegram: 1, telegramLinkCode: 1 } });
  }

  findByTelegramId(tgUserId: number) {
    return UserModel.findOne({ 'telegram.userId': tgUserId });
  }
}
