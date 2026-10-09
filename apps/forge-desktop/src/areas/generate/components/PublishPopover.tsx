import { useEffect, useRef, useState } from 'react'
import { useThreeWsStore } from '@shared/stores/threeWsStore'
import { AVATAR_VISIBILITIES, type AvatarVisibility, type PublishResult } from '@shared/types/threeWs'
import { defaultPublishName, parseTags } from '../threeWsPublish'

// Publish the open model to the signed-in three.ws account. It lands in the
// account's library at three.ws/avatars/<id>, where it can be shared, embedded,
// rigged or used as an agent body.

const VISIBILITY_HINT: Record<AvatarVisibility, string> = {
  private:  'Only you can see it.',
  unlisted: 'Anyone with the link can see it.',
  public:   'Listed on your profile and in search.',
}

function SignInPrompt(): JSX.Element {
  const link = useThreeWsStore((s) => s.link)
  const startLink = useThreeWsStore((s) => s.startLink)
  const cancelLink = useThreeWsStore((s) => s.cancelLink)

  if (link.status === 'waiting') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-zinc-400">Approve Forge in your browser. The page should show this code:</p>
        <p className="font-mono text-lg tracking-[0.25em] text-zinc-100 select-all">{link.link.userCode}</p>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Waiting for approval
          </span>
          <button type="button" onClick={() => window.electron.threews.open(link.link.verificationUrl)} className="text-accent-light hover:underline">
            Open again
          </button>
          <button type="button" onClick={() => void cancelLink()} className="text-zinc-500 hover:text-zinc-300">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        Sign in to save this model to your three.ws account, where you can share it, embed it, or give it to an agent.
      </p>
      <button
        type="button"
        onClick={() => void startLink()}
        disabled={link.status === 'starting'}
        className="self-start px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-dark text-white text-xs font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-light"
      >
        {link.status === 'starting' ? 'Opening three.ws…' : 'Sign in to three.ws'}
      </button>
    </div>
  )
}

function Published({ result, onAnother }: { result: PublishResult; onAnother: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(result.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-3" role="status">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-100 truncate">{result.name}</p>
          <p className="text-[11px] text-zinc-500 capitalize">Published, {result.visibility}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/50">
        <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-zinc-400">{result.url}</span>
        <button type="button" onClick={() => void copy()} className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-100 transition-colors">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.electron.threews.open(result.url)}
          className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-dark text-white text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-light"
        >
          Open on three.ws
        </button>
        <button type="button" onClick={onAnother} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          Publish again
        </button>
      </div>
    </div>
  )
}

export default function PublishPopover({ outputUrl, onClose }: { outputUrl: string; onClose: () => void }): JSX.Element {
  const account = useThreeWsStore((s) => s.account)
  const accountError = useThreeWsStore((s) => s.error)
  const refresh = useThreeWsStore((s) => s.refresh)
  const [name, setName] = useState(() => defaultPublishName(outputUrl))
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [visibility, setVisibility] = useState<AvatarVisibility>('unlisted')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!account) void refresh() }, [account, refresh])
  useEffect(() => { if (account?.signedIn) nameRef.current?.select() }, [account?.signedIn])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !publishing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, publishing])

  async function publish(): Promise<void> {
    if (!name.trim() || publishing) return
    setPublishing(true)
    setError(null)
    const res = await window.electron.threews.publish({
      outputUrl,
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
      tags: parseTags(tags),
    })
    setPublishing(false)
    if (res.ok) setResult(res.value)
    else {
      setError(res.error)
      // A revoked key signs Forge out in the main process; show the prompt.
      if (res.code === 'signed_out' || res.code === 'unauthorized') void refresh()
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Publish to three.ws"
      className="absolute top-full left-0 mt-1 z-50 w-80 bg-zinc-900 border border-zinc-700/60 rounded-xl p-3.5 shadow-xl flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-100">Publish to three.ws</p>
        {account?.signedIn && (
          <span className="text-[10px] text-zinc-500 truncate max-w-[140px]" title={account.email ?? undefined}>
            {account.username ? `@${account.username}` : account.email ?? 'Signed in'}
          </span>
        )}
      </div>

      {account === null ? (
        accountError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-[11px] text-red-300">
            <span>{accountError}</span>
            <button type="button" onClick={() => void refresh()} className="shrink-0 hover:underline">Retry</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-busy="true">
            <div className="h-3 w-3/4 rounded bg-zinc-800 animate-pulse" />
            <div className="h-7 w-32 rounded-lg bg-zinc-800 animate-pulse" />
          </div>
        )
      ) : !account.signedIn ? (
        <SignInPrompt />
      ) : result ? (
        <Published result={result} onAnother={() => setResult(null)} />
      ) : (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => { e.preventDefault(); void publish() }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Optional"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Tags</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="chair, furniture"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">Visibility</legend>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-zinc-800 border border-zinc-700/60">
              {AVATAR_VISIBILITIES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={visibility === v}
                  onClick={() => setVisibility(v)}
                  className={`py-1 rounded-md text-[11px] capitalize transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-light ${
                    visibility === v ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500">{VISIBILITY_HINT[visibility]}</p>
          </fieldset>

          {error && <p role="alert" className="text-[11px] text-red-300 leading-relaxed">{error}</p>}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="submit"
              disabled={publishing || !name.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-dark text-white text-xs font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-light"
            >
              {publishing && (
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              {publishing ? 'Uploading…' : error ? 'Try again' : 'Publish'}
            </button>
            <button type="button" onClick={onClose} disabled={publishing} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
