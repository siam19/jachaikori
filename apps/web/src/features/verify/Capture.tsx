import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { ClipboardPaste, FileText, ImagePlus, Upload, X } from 'lucide-react';
import type { VerificationCheck } from '@jachaikori/schema';
import { verifyImage, verifyText } from '../../api/client';
import { ApiError, classify, type Failure } from '../../api/errors';
import { tt, type Lang } from '../../i18n/tt';
import {
  downscaleIfLarge,
  MAX_UPLOAD_BYTES,
  SUPPORTED_IMAGE_TYPES,
} from '../../lib/downscale';
import { PressRun } from './PressRun';
import { StateCard } from '../../ui/StateCard';
import { Banner } from '../../ui/Banner';

type CaptureTab = 'photo' | 'paste' | 'text';

interface CaptureProps {
  lang: Lang;
  initialTab?: CaptureTab;
  initialText?: string;
}

export function Capture({ lang, initialTab = 'photo', initialText = '' }: CaptureProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<CaptureTab>(initialTab);
  const [dragActive, setDragActive] = useState(false);
  const [textValue, setTextValue] = useState(initialText);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [sharedNotice, setSharedNotice] = useState(false);
  const [clientFailure, setClientFailure] = useState<Failure | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onSuccessCheck = useCallback(
    (check: VerificationCheck) => {
      queryClient.setQueryData(['check', check.id], check);
      void queryClient.invalidateQueries({ queryKey: ['checks', 'popular'] });
      navigate(`/checks/${encodeURIComponent(check.id)}`, {
        state: { freshCheck: check },
      });
    },
    [navigate, queryClient]
  );

  const imageMutation = useMutation({
    mutationFn: async (file: File) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      return verifyImage({ file, signal: ctrl.signal });
    },
    retry: (failureCount, err) => {
      if (classify(err) === 'upstream' && failureCount < 2) {
        setRetryAttempt(failureCount + 1);
        return true;
      }
      return false;
    },
    retryDelay: (attempt) => 2000 * (attempt + 1),
    onSuccess: (data) => {
      setRetryAttempt(0);
      onSuccessCheck(data);
    },
    onError: () => {
      setRetryAttempt(0);
    },
  });

  const textMutation = useMutation({
    mutationFn: async (text: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      return verifyText({ text, signal: ctrl.signal });
    },
    retry: (failureCount, err) => {
      if (classify(err) === 'upstream' && failureCount < 2) {
        setRetryAttempt(failureCount + 1);
        return true;
      }
      return false;
    },
    retryDelay: (attempt) => 2000 * (attempt + 1),
    onSuccess: (data) => {
      setRetryAttempt(0);
      onSuccessCheck(data);
    },
    onError: () => {
      setRetryAttempt(0);
    },
  });

  const submitFile = useCallback(
    async (rawFile: File) => {
      setClientFailure(null);
      setPasteNotice(null);
      imageMutation.reset();
      textMutation.reset();

      if (!SUPPORTED_IMAGE_TYPES.has(rawFile.type)) {
        setClientFailure('bad_format');
        return;
      }

      let prepared = rawFile;
      try {
        prepared = await downscaleIfLarge(rawFile);
      } catch {
        // Fallback to raw file if bitmap decode fails
      }

      if (prepared.size > MAX_UPLOAD_BYTES) {
        setClientFailure('too_large');
        return;
      }

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(prepared);
      setPreviewUrl(url);
      setLastFile(prepared);
      imageMutation.mutate(prepared);
    },
    [imageMutation, previewUrl, textMutation]
  );

  const submitTextClaim = useCallback(
    (value?: string) => {
      const clean = (value ?? textValue).trim();
      if (clean.length < 3) return;
      setClientFailure(null);
      setPasteNotice(null);
      imageMutation.reset();
      textMutation.mutate(clean);
    },
    [imageMutation, textMutation, textValue]
  );

  // Cleanup preview blob URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Global Ctrl+V / Cmd+V paste listener
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement;
      const inTextInput =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            setTab('photo');
            void submitFile(f);
            return;
          }
        }
      }

      if (!inTextInput && tab === 'paste') {
        const pastedText = e.clipboardData?.getData('text');
        if (pastedText && pastedText.trim()) {
          setTab('text');
          setTextValue(pastedText.trim());
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [submitFile, tab]);

  // PWA Android Share Target inbox pickup (`/?shared=1`)
  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;
    let cancelled = false;
    (async () => {
      try {
        if (!('caches' in window)) return;
        const inbox = await caches.open('share-inbox');
        const imgRes = await inbox.match('/inbox/image');
        const txtRes = await inbox.match('/inbox/text');

        await inbox.delete('/inbox/image');
        await inbox.delete('/inbox/text');

        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('shared');
            return next;
          },
          { replace: true }
        );

        if (imgRes) {
          const blob = await imgRes.blob();
          const name = decodeURIComponent(imgRes.headers.get('x-filename') || 'shared-card.jpg');
          const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
          setSharedNotice(true);
          void submitFile(file);
        } else if (txtRes) {
          const sharedText = (await txtRes.text()).trim();
          if (sharedText) {
            setTab('text');
            setTextValue(sharedText);
            setSharedNotice(true);
            submitTextClaim(sharedText);
          }
        }
      } catch {
        // ignore cache errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams, submitFile, submitTextClaim]);

  const handleClipboardButton = async () => {
    setPasteNotice(null);
    try {
      if (!navigator.clipboard?.read) {
        setPasteNotice(tt('cap.paste.hint', lang));
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => SUPPORTED_IMAGE_TYPES.has(t));
        if (imgType) {
          const blob = await item.getType(imgType);
          const ext = imgType === 'image/png' ? 'png' : imgType === 'image/webp' ? 'webp' : 'jpg';
          const file = new File([blob], `clipboard-card.${ext}`, { type: imgType });
          void submitFile(file);
          return;
        }
      }
      setPasteNotice(tt('cap.paste.empty', lang));
    } catch {
      setPasteNotice(tt('cap.paste.hint', lang));
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void submitFile(file);
  };

  const isRunning = imageMutation.isPending || textMutation.isPending;
  const activeError =
    clientFailure ??
    (imageMutation.error ? classify(imageMutation.error) : null) ??
    (textMutation.error ? classify(textMutation.error) : null);

  const handleCancel = () => {
    abortRef.current?.abort();
    imageMutation.reset();
    textMutation.reset();
  };

  const handleRetry = () => {
    setClientFailure(null);
    if (tab === 'text' && textValue.trim()) {
      submitTextClaim();
    } else if (lastFile) {
      imageMutation.mutate(lastFile);
    } else {
      imageMutation.reset();
      textMutation.reset();
      fileInputRef.current?.click();
    }
  };

  if (isRunning) {
    return (
      <PressRun
        previewUrl={imageMutation.isPending ? previewUrl : null}
        previewText={textMutation.isPending ? textValue : null}
        retryAttempt={retryAttempt}
        lang={lang}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <section className="space-y-3" aria-label={tt('cap.title', lang)}>
      {sharedNotice ? (
        <Banner onDismiss={() => setSharedNotice(false)}>{tt('cap.shared', lang)}</Banner>
      ) : null}

      {/* Three equal capture modes */}
      <div
        className="inline-flex rounded-xl border border-rule-strong bg-paper-raised overflow-hidden"
        role="tablist"
        aria-label={tt('cap.title', lang)}
      >
        {(
          [
            { id: 'photo', key: 'cap.tab.photo', Icon: ImagePlus },
            { id: 'paste', key: 'cap.tab.paste', Icon: ClipboardPaste },
            { id: 'text', key: 'cap.tab.text', Icon: FileText },
          ] as const
        ).map(({ id, key, Icon }, idx) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setClientFailure(null);
              setPasteNotice(null);
            }}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer min-h-[44px] transition-colors ${
              idx > 0 ? 'border-s border-rule-strong' : ''
            } ${
              tab === id
                ? 'bg-ink text-paper font-medium'
                : 'text-ink hover:bg-paper-sunk'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            <span>{tt(key, lang)}</span>
          </button>
        ))}
      </div>

      {/* Paper-slip capture box */}
      {tab === 'photo' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors bg-paper-raised ${
            dragActive ? 'border-ink bg-paper-sunk' : 'border-rule-strong'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void submitFile(file);
              e.target.value = '';
            }}
          />
          <div className="mx-auto max-w-md space-y-3">
            <Upload className="mx-auto h-7 w-7 text-pencil" strokeWidth={1.5} aria-hidden="true" />
            <p className="font-display text-lg text-ink m-0">{tt('cap.drop', lang)}</p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:opacity-90 cursor-pointer min-h-[44px]"
              >
                <ImagePlus className="h-4 w-4" strokeWidth={1.5} />
                <span>{tt('cap.add', lang)}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleClipboardButton()}
                className="inline-flex items-center gap-2 rounded-xl border border-rule-strong bg-paper-raised text-ink px-4 py-2.5 text-sm font-medium hover:bg-paper-sunk cursor-pointer min-h-[44px]"
              >
                <ClipboardPaste className="h-4 w-4" strokeWidth={1.5} />
                <span>{tt('cap.tab.paste', lang)}</span>
              </button>
            </div>
            <p className="text-xs text-pencil m-0">{tt('cap.formats', lang)}</p>
            {pasteNotice ? <p className="text-xs text-ink m-0">{pasteNotice}</p> : null}
          </div>
        </div>
      ) : tab === 'paste' ? (
        <div className="rounded-xl border-2 border-dashed border-rule-strong bg-paper-raised p-6 sm:p-8 text-center space-y-3">
          <ClipboardPaste className="mx-auto h-7 w-7 text-pencil" strokeWidth={1.5} aria-hidden="true" />
          <p className="font-display text-lg text-ink m-0">{tt('cap.paste.hint', lang)}</p>
          <button
            type="button"
            onClick={() => void handleClipboardButton()}
            className="inline-flex items-center gap-2 rounded-xl bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:opacity-90 cursor-pointer min-h-[44px]"
          >
            <ClipboardPaste className="h-4 w-4" strokeWidth={1.5} />
            <span>{tt('cap.paste.button', lang)}</span>
          </button>
          {pasteNotice ? <p className="text-xs text-ink m-0">{pasteNotice}</p> : null}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitTextClaim();
          }}
          className="rounded-xl border border-rule-strong bg-paper-raised p-4 sm:p-5 space-y-3"
        >
          <label htmlFor="verify-text-input" className="block text-sm font-medium text-ink">
            {tt('cap.text.label', lang)}
          </label>
          <textarea
            id="verify-text-input"
            rows={4}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={tt('cap.text.placeholder', lang)}
            className="w-full rounded-xl border border-rule-strong bg-paper p-3 text-base ink-text placeholder:font-ui placeholder:text-pencil resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            {textValue ? (
              <button
                type="button"
                onClick={() => setTextValue('')}
                className="inline-flex items-center gap-1 text-xs text-pencil hover:text-ink cursor-pointer"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{tt('nav.close', lang)}</span>
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={textValue.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-xl bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 cursor-pointer min-h-[44px]"
            >
              {tt('cap.text.submit', lang)}
            </button>
          </div>
        </form>
      )}

      {/* Calm, blame-free error card (never rust) */}
      {activeError ? (
        <FailureStateCard
          failure={activeError}
          lang={lang}
          onRetry={handleRetry}
          onSwitchText={() => {
            setClientFailure(null);
            imageMutation.reset();
            setTab('text');
          }}
          rawError={imageMutation.error ?? textMutation.error}
        />
      ) : null}

      {/* Visible privacy notice directly under dropzone (v0.2 decision) */}
      <p className="text-xs text-pencil leading-relaxed m-0">{tt('cap.notice', lang)}</p>
    </section>
  );
}

function FailureStateCard({
  failure,
  lang,
  onRetry,
  onSwitchText,
  rawError,
}: {
  failure: Failure;
  lang: Lang;
  onRetry: () => void;
  onSwitchText: () => void;
  rawError?: unknown;
}) {
  const keyMap = {
    bad_format: {
      title: 'err.badFormat.title',
      body: 'err.badFormat.body',
      action: 'err.badFormat.action',
    },
    too_large: {
      title: 'err.tooLarge.title',
      body: 'err.tooLarge.body',
      action: 'err.tooLarge.action',
    },
    upstream: {
      title: 'err.upstream.title',
      body: 'err.upstream.body',
      action: 'err.upstream.action',
    },
    offline: {
      title: 'err.offline.title',
      body: 'err.offline.body',
      action: 'err.offline.action',
    },
    not_found: {
      title: 'err.notFound.title',
      body: 'err.notFound.body',
      action: 'err.notFound.action',
    },
    unknown: {
      title: 'err.unknown.title',
      body: 'err.unknown.body',
      action: 'err.upstream.action',
    },
  } as const;

  const keys = keyMap[failure];
  const apiMessage =
    rawError instanceof ApiError &&
    rawError.body &&
    typeof rawError.body === 'object' &&
    'error' in rawError.body &&
    typeof (rawError.body as { error?: unknown }).error === 'string'
      ? (rawError.body as { error: string }).error
      : null;

  return (
    <StateCard
      title={tt(keys.title, lang)}
      body={apiMessage ? `${tt(keys.body, lang)} (${apiMessage})` : tt(keys.body, lang)}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center rounded-xl bg-ink text-paper px-4 py-2 text-xs font-medium hover:opacity-90 cursor-pointer"
        >
          {tt(keys.action, lang)}
        </button>
      }
      secondaryAction={
        <button
          type="button"
          onClick={onSwitchText}
          className="inline-flex items-center rounded-xl border border-rule-strong bg-paper-raised px-3.5 py-2 text-xs font-medium text-ink hover:bg-paper-sunk cursor-pointer"
        >
          {tt('cap.tab.text', lang)}
        </button>
      }
    />
  );
}
