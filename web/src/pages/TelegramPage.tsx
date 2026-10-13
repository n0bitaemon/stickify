import { CheckCircle2, Download, ExternalLink, Link2, Loader2, Send, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { GuideButton } from '../components/GuideButton';
import { api } from '../lib/api';
import { useInterval } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { TelegramStatus } from '../lib/types';

const LINK_STEPS = [
  'Click "Link with Telegram" – Telegram opens a chat with the Stickify bot.',
  'Press Start. The bot confirms and this page updates by itself.',
  'Then forward stickers, photos or pack links to the bot, and push packs to Telegram from any pack page.',
];

/** Telegram account linking: send stickers to the bot and push converted packs straight to Telegram. */
export function TelegramPage() {
  const toast = useToast();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<{ deepLink: string; code: string } | null>(null);

  const loadStatus = () => api.telegramStatus().then(setStatus).catch(() => undefined);
  useEffect(() => void loadStatus(), []);
  // After the deep link opens, wait for the bot to confirm and refresh automatically.
  useInterval(loadStatus, 2500, Boolean(link && !status?.linked));

  const createLink = async () => {
    try {
      const r = await api.telegramLinkCode();
      setLink(r);
      window.open(r.deepLink, '_blank', 'noopener');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const unlink = async () => {
    await api.telegramUnlink();
    setLink(null);
    void loadStatus();
    toast('Telegram account unlinked');
  };

  const disabled = status !== null && !status.configured;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Telegram</h1>
        <p className="mt-1 text-sm text-muted">Link your account to send stickers to the bot and push converted packs straight to Telegram.</p>
      </div>

      {disabled && (
        <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <code className="font-mono">TELEGRAM_BOT_TOKEN</code> is not configured on the server. Create a bot with @BotFather and put its token in the <code>.env</code> file.
        </div>
      )}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-medium">
            <Link2 className="size-4 text-brand" /> Link your Telegram account
          </h2>
          {!status?.linked && <GuideButton label="How linking works" title="Linking Telegram" steps={LINK_STEPS} />}
        </div>
        {status?.linked ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <span className="text-sm">
              Linked{status.telegramUsername ? ` to @${status.telegramUsername}` : ''}. Send stickers, photos or pack links to{' '}
              {status.botUsername ? (
                <a className="text-brand hover:underline" href={`https://t.me/${status.botUsername}`} target="_blank" rel="noreferrer">
                  @{status.botUsername}
                </a>
              ) : (
                'the bot'
              )}{' '}
              to add them to Stickify.
            </span>
            <button onClick={unlink} className="btn btn-danger ml-auto">
              <Unlink className="size-4" /> Unlink
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <button onClick={createLink} disabled={disabled} className="btn btn-primary">
              <Send className="size-4" /> Link with Telegram
            </button>
            {link && (
              <a href={link.deepLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                Open the link again <ExternalLink className="size-3.5" />
              </a>
            )}
            {link && (
              <span className="flex items-center gap-2 text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Waiting for confirmation… (the code expires in 15 minutes)
              </span>
            )}
          </div>
        )}
      </section>

      <Link to="/import?source=telegram" className="card flex items-center gap-3 p-5 transition hover:bg-surface-2">
        <Download className="size-5 text-brand" />
        <span className="flex-1">
          <span className="block font-medium">Import a whole pack from a link</span>
          <span className="text-sm text-muted">Paste a t.me/addstickers/… link – no account linking needed.</span>
        </span>
      </Link>
    </div>
  );
}
