import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../domain/errors.js';
import type { ProcessingOptions } from '../../domain/media.js';
import type { PlatformId } from '../../domain/platforms.js';
import { UserModel, type UserDocument } from '../../infrastructure/db/models/user.model.js';
import { toObjectId } from './ids.js';

const BCRYPT_ROUNDS = 12;

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export class AuthService {
  // Dummy hash compared when the email does not exist → same response time either way,
  // so timing does not reveal which emails are registered.
  private readonly dummyHash = bcrypt.hashSync('stickify-dummy-password', BCRYPT_ROUNDS);

  constructor(private readonly config: AuthConfig) {}

  private sign(user: UserDocument): string {
    return jwt.sign({ sub: user.id }, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn as SignOptions['expiresIn'],
      algorithm: 'HS256',
    });
  }

  /** Returns the user id for a valid token, otherwise throws UnauthorizedError. */
  verify(token: string): string {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || !payload.sub) throw new Error('payload');
      return payload.sub;
    } catch {
      throw new UnauthorizedError('Your session is invalid or has expired');
    }
  }

  async register(input: { email: string; password: string; displayName: string }) {
    if (await UserModel.exists({ email: input.email.toLowerCase() })) throw new ConflictError('This email is already registered');
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    try {
      const user = await UserModel.create({ email: input.email, displayName: input.displayName, passwordHash });
      return { user, token: this.sign(user) };
    } catch (err) {
      // Two parallel sign-ups with the same email → the unique index catches it.
      if ((err as { code?: number }).code === 11000) throw new ConflictError('This email is already registered');
      throw err;
    }
  }

  async login(input: { email: string; password: string }) {
    const user = await UserModel.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !ok) throw new UnauthorizedError('Wrong email or password');
    return { user, token: this.sign(user) };
  }

  async getUser(userId: string): Promise<UserDocument> {
    const user = await UserModel.findById(toObjectId(userId));
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string; defaultPlatform?: PlatformId; processing?: Partial<ProcessingOptions> },
  ): Promise<UserDocument> {
    const user = await this.getUser(userId);
    if (input.displayName) user.displayName = input.displayName;
    if (input.defaultPlatform) user.set('preferences.defaultPlatform', input.defaultPlatform);
    if (input.processing) {
      user.set('preferences.processing', { ...user.toObject().preferences?.processing, ...input.processing });
    }
    return user.save();
  }
}
