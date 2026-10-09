import { useEffect, useState } from 'react'
import { Section, Card, Row } from '@shared/ui'
import { useThreeWsStore } from '@shared/stores/threeWsStore'

// Settings → three.ws: connect Forge to a three.ws account. Browser sign-in uses
// the same device flow as the three-ws CLI, so nothing is typed into Forge; a
// pasted API key is the alternative for headless or managed machines.

function useCountdown(startedAt: number, seconds: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.round(seconds - (now - startedAt) / 1000))
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function WaitingForApproval(): JSX.Element | null {
  const link = useThreeWsStore((s) => s.link)
  const cancelLink = useThreeWsStore((s) => s.cancelLink)
  const startedAt = link.status === 'waiting' ? link.startedAt : Date.now()
  const expiresIn = link.status === 'waiting' ? link.link.expiresIn : 0
  const remaining = useCountdown(startedAt, expiresIn)
  if (link.status !== 'waiting') return null

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <p className="text-[11px] text-zinc-400">
        Your browser opened three.ws. Check that it shows this code, then approve:
      </p>
      <p className="font-mono text-2xl tracking-[0.3em] text-zinc-100 select-all" aria-label="Sign-in code">
        {link.link.userCode}
      </p>
      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Waiting for approval, expires in {formatRemaining(remaining)}
        </span>
        <button
          type="button"
          onClick={() => window.electron.threews.open(link.link.verificationUrl)}
          className="text-accent-light hover:underline focus:outline-none focus-visible:underline"
        >
          Open the page again
        </button>
        <button
          type="button"
          onClick={() => void cancelLink()}
          className="text-zinc-500 hover:text-zinc-300 focus:outline-none focus-visible:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SignedOut(): JSX.Element {
  const link = useThreeWsStore((s) => s.link)
  const loading = useThreeWsStore((s) => s.loading)
  const startLink = useThreeWsStore((s) => s.startLink)
  const signInWithKey = useThreeWsStore((s) => s.signInWithKey)
  const [key, setKey] = useState('')
  const [visible, setVisible] = useState(false)

  async function submitKey(): Promise<void> {
    if (!key.trim()) return
    if (await signInWithKey(key.trim())) setKey('')
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card
        title="Sign in with your browser"
        description="Recommended. Approve Forge on three.ws and it receives its own API key, which you can revoke at any time from your dashboard."
      >
        {link.status === 'waiting' ? (
          <WaitingForApproval />
        ) : (
          <div className="px-4 py-4">
            <button
              type="button"
              onClick={() => void startLink()}
              disabled={link.status === 'starting'}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white text-xs font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-light"
            >
              {link.status === 'starting' ? 'Opening three.ws…' : 'Sign in to three.ws'}
            </button>
          </div>
        )}
      </Card>

      <Card
        title="Use an API key"
        description={
          <>
            For managed machines. Create a key at{' '}
            <button
              type="button"
              onClick={() => window.electron.threews.open('/dashboard/developers')}
              className="text-accent-light hover:underline"
            >
              three.ws/dashboard/developers
            </button>{' '}
            with the avatars:write scope.
          </>
        }
      >
        <Row label="API key" description="Stored encrypted on this machine.">
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type={visible ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitKey()}
                placeholder="sk_live_…"
                spellCheck={false}
                aria-label="three.ws API key"
                className="w-52 px-3 py-1.5 pr-8 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                title={visible ? 'Hide key' : 'Show key'}
                aria-label={visible ? 'Hide key' : 'Show key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              onClick={() => void submitKey()}
              disabled={loading || !key.trim()}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent/15 hover:bg-accent/25 text-accent-light transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
            >
              {loading ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </Row>
      </Card>
    </div>
  )
}

function SignedIn(): JSX.Element {
  const account = useThreeWsStore((s) => s.account)
  const signOut = useThreeWsStore((s) => s.signOut)
  const [confirming, setConfirming] = useState(false)
  if (!account) return <></>

  const name = account.displayName || account.username || account.email || 'three.ws account'
  const scopes = account.scope.split(/\s+/).filter(Boolean)

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Connected"
        description="Forge publishes models to this account and runs three.ws Forge cloud generation on its plan."
        aside={<span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold">Signed in</span>}
      >
        <Row label="Account" description={account.email && account.email !== name ? account.email : undefined}>
          <span className="text-xs text-zinc-200">{name}</span>
        </Row>
        {account.plan && (
          <Row label="Plan">
            <span className="text-xs text-zinc-300 capitalize">{account.plan}</span>
          </Row>
        )}
        {account.keyPrefix && (
          <Row label="API key" description="Revoke it from the three.ws dashboard to disconnect every copy of Forge using it.">
            <span className="text-xs font-mono text-zinc-400">{account.keyPrefix}…</span>
          </Row>
        )}
        {scopes.length > 0 && (
          <Row label="Permissions">
            <div className="flex flex-wrap justify-end gap-1 max-w-xs">
              {scopes.map((s) => (
                <span key={s} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">{s}</span>
              ))}
            </div>
          </Row>
        )}
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => window.electron.threews.open('/dashboard')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
          >
            Open dashboard
          </button>
          {account.username && (
            <button
              type="button"
              onClick={() => window.electron.threews.open(`/u/${encodeURIComponent(account.username ?? '')}`)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
            >
              View profile
            </button>
          )}
          <div className="flex-1" />
          {confirming ? (
            <>
              <span className="text-[11px] text-zinc-500">Forget the key on this machine?</span>
              <button
                type="button"
                onClick={() => { setConfirming(false); void signOut() }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-400 transition-colors"
              >
                Sign out
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-red-400 transition-colors focus:outline-none focus-visible:text-red-400"
            >
              Sign out
            </button>
          )}
        </div>
      </Card>
    </div>
  )
}

export function ThreeWsSection(): JSX.Element {
  const account = useThreeWsStore((s) => s.account)
  const loading = useThreeWsStore((s) => s.loading)
  const error = useThreeWsStore((s) => s.error)
  const refresh = useThreeWsStore((s) => s.refresh)

  useEffect(() => { void refresh() }, [refresh])

  return (
    <Section title="three.ws" subtitle="Publish what you make to your three.ws account and use three.ws Forge cloud generation.">
      {error && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()} className="shrink-0 text-red-200 hover:underline">Retry</button>
        </div>
      )}
      {account === null && loading ? (
        <div className="grid grid-cols-2 gap-4" aria-busy="true">
          <div className="h-32 rounded-xl bg-surface-300 border border-zinc-800 animate-pulse" />
          <div className="h-32 rounded-xl bg-surface-300 border border-zinc-800 animate-pulse" />
        </div>
      ) : account?.signedIn ? (
        <SignedIn />
      ) : (
        <SignedOut />
      )}
    </Section>
  )
}
