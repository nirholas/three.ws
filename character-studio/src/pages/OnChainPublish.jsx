import React, { useContext, useState } from 'react';
import { SceneContext } from '../context/SceneContext';
import { registerCharacterOnChain, getSupportedChains } from '../library/erc8004';
import styles from './OnChainPublish.module.css';

const PINATA_JWT_KEY = 'characterstudio:pinata-jwt';

function loadSavedJWT() {
  try { return localStorage.getItem(PINATA_JWT_KEY) || ''; }
  catch { return ''; }
}
function saveJWT(jwt) {
  try { if (jwt) localStorage.setItem(PINATA_JWT_KEY, jwt); else localStorage.removeItem(PINATA_JWT_KEY); }
  catch { /* storage disabled */ }
}

export default function OnChainPublish({ onClose }) {
  const { characterManager } = useContext(SceneContext);
  const [pinataJWT, setPinataJWT] = useState(loadSavedJWT);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const manifestURL = characterManager?.getManifestURL?.() || '';
  const chains = getSupportedChains();

  async function handlePublish() {
    setError('');
    setResult(null);
    setStatus('');
    if (!manifestURL) { setError('No manifest loaded — open a character collection first.'); return; }
    if (!pinataJWT.trim()) { setError('Enter your Pinata JWT to pin files to IPFS.'); return; }
    saveJWT(pinataJWT.trim());
    setBusy(true);
    try {
      const r = await registerCharacterOnChain({
        name: 'Character Studio Manifest',
        manifestURL,
        pinataJWT: pinataJWT.trim(),
        onStatus: setStatus,
      });
      setResult(r);
    } catch (err) {
      setError(err.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const chainNames = Object.values(chains).map((c) => c.name).join(', ');

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Publish on-chain</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">&#x2715;</button>
        </div>

        {!result ? (
          <>
            <p className={styles.description}>
              Mint an ERC-8004 token on-chain pointing to this character manifest.
              The token links to: <code className={styles.url}>{manifestURL || '(no manifest loaded)'}</code>
            </p>

            <label className={styles.label}>
              Pinata JWT
              <input
                className={styles.input}
                type="password"
                placeholder="eyJhbGci…"
                value={pinataJWT}
                onChange={(e) => setPinataJWT(e.target.value)}
                disabled={busy}
              />
              <span className={styles.hint}>
                Used to pin the registration JSON to IPFS.{' '}
                <a href="https://app.pinata.cloud/keys" target="_blank" rel="noopener noreferrer">
                  Get a key →
                </a>
              </span>
            </label>

            <p className={styles.hint}>
              Supported chains: {chainNames}.<br />
              Switch your wallet to any of these before clicking Publish.
            </p>

            {status && <p className={styles.status}>{status}</p>}
            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
              <button className={styles.publishBtn} onClick={handlePublish} disabled={busy || !manifestURL}>
                {busy ? 'Publishing…' : '⬡ Publish on-chain'}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.success}>
            <div className={styles.successIcon}>✓</div>
            <p>Minted on-chain!</p>
            <p>Agent ID: <strong>{result.agentId}</strong></p>
            <p>Chain: <strong>{result.chainId}</strong></p>
            <p className={styles.txHash}>
              Tx: <code>{result.txHash.slice(0, 18)}…</code>
            </p>
            <p className={styles.hint}>
              Registration: <code>{result.registrationURL}</code>
            </p>
            <button className={styles.publishBtn} onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
