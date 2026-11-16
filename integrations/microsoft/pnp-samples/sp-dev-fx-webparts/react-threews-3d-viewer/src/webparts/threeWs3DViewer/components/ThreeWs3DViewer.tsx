import * as React from 'react';
import * as strings from 'ThreeWs3DViewerWebPartStrings';

import styles from './ThreeWs3DViewer.module.scss';
import type { IThreeWs3DViewerProps } from './IThreeWs3DViewerProps';
import { CATALOG_URL, viewerUrl } from '../helpers/model';
import { loadAgentRuntime, RUNTIME_TRUSTED_SOURCE, RuntimeBlockedError } from '../helpers/runtime';

type LoadState = 'loading' | 'ready' | 'blocked' | 'failed';

interface IAgentErrorDetail {
  phase?: string;
  error?: { message?: string };
}

function Skeleton(): React.ReactElement {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite">
      <span className={styles.srOnly}>{strings.Loading}</span>
    </div>
  );
}

function EmptyState(props: { invalid: boolean; isEditMode: boolean; onConfigure: () => void }): React.ReactElement {
  if (!props.isEditMode) {
    return <div className={styles.empty}><p className={styles.emptyBody}>{strings.EmptyReaderBody}</p></div>;
  }
  return (
    <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>{strings.EmptyTitle}</h3>
      <p className={styles.emptyBody}>{props.invalid ? strings.InvalidUrlBody : strings.EmptyBody}</p>
      <div className={styles.emptyActions}>
        <button type="button" className={styles.primary} onClick={props.onConfigure}>{strings.ConfigureButton}</button>
        <a className={styles.link} href={CATALOG_URL} target="_blank" rel="noopener noreferrer">{strings.CatalogLinkText}</a>
      </div>
    </div>
  );
}

function ViewerFrame(props: { modelUrl: string; title: string; height: number }): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false);
  const src = viewerUrl(props.modelUrl, props.title);
  React.useEffect(() => setLoaded(false), [src]);
  return (
    <div className={styles.stage} style={{ height: props.height }}>
      {!loaded && <Skeleton />}
      <iframe
        key={src}
        className={styles.frame}
        src={src}
        title={`${strings.ViewerFrameTitle} ${props.title}`}
        allow="fullscreen; xr-spatial-tracking"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function AgentComponent(props: { modelUrl: string; title: string; height: number }): React.ReactElement {
  const [state, setState] = React.useState<LoadState>('loading');
  const [message, setMessage] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const host = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let active = true;
    setState('loading');
    loadAgentRuntime().then(
      () => { if (active) setState('ready'); },
      (err: Error) => {
        if (!active) return;
        setMessage(err.message);
        setState(err instanceof RuntimeBlockedError ? 'blocked' : 'failed');
      }
    );
    return () => { active = false; };
  }, [attempt]);

  React.useEffect(() => {
    const node = host.current?.querySelector('agent-3d');
    if (state !== 'ready' || !node) return;
    const onError = (event: Event): void => {
      const detail = (event as CustomEvent<IAgentErrorDetail>).detail;
      if (detail?.phase !== 'boot' && detail?.phase !== 'policy') return;
      setMessage(detail?.error?.message || '');
      setState('failed');
    };
    node.addEventListener('agent:error', onError);
    return () => node.removeEventListener('agent:error', onError);
  }, [state, props.modelUrl]);

  if (state === 'blocked') {
    return (
      <div className={styles.notice} role="alert">
        <h3 className={styles.noticeTitle}>{strings.BlockedTitle}</h3>
        <p>{strings.BlockedBody}</p>
        <code className={styles.code}>{RUNTIME_TRUSTED_SOURCE}</code>
        <p>{strings.BlockedHint}</p>
        <button type="button" className={styles.secondary} onClick={() => setAttempt(attempt + 1)}>{strings.RetryButton}</button>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className={styles.notice} role="alert">
        <h3 className={styles.noticeTitle}>{strings.LoadFailedTitle}</h3>
        {message && <p>{message}</p>}
        <button type="button" className={styles.secondary} onClick={() => setAttempt(attempt + 1)}>{strings.RetryButton}</button>
      </div>
    );
  }
  return (
    <div className={styles.stage} style={{ height: props.height }} ref={host}>
      {state === 'loading' && <Skeleton />}
      {state === 'ready' && React.createElement('agent-3d', {
        key: `${props.modelUrl}#${attempt}`,
        body: props.modelUrl,
        chat: 'off',
        'name-plate': 'off',
        background: 'transparent',
        width: '100%',
        height: `${props.height}px`,
        'aria-label': `${strings.ViewerFrameTitle} ${props.title}`,
        className: styles.agent
      })}
    </div>
  );
}

export default function ThreeWs3DViewer(props: IThreeWs3DViewerProps): React.ReactElement {
  const title = props.title || strings.DefaultTitle;
  return (
    <section className={styles.threeWs3DViewer} aria-label={title}>
      {props.title && <h2 className={styles.title}>{props.title}</h2>}
      {!props.modelUrl ? (
        <EmptyState invalid={props.hasInvalidUrl} isEditMode={props.isEditMode} onConfigure={props.onConfigure} />
      ) : (
        <>
          {props.displayMode === 'component'
            ? <AgentComponent modelUrl={props.modelUrl} title={title} height={props.height} />
            : <ViewerFrame modelUrl={props.modelUrl} title={title} height={props.height} />}
          <div className={styles.footer}>
            <a className={styles.link} href={viewerUrl(props.modelUrl, title)} target="_blank" rel="noopener noreferrer">{strings.OpenInThreews}</a>
            <a className={styles.link} href={props.modelUrl} target="_blank" rel="noopener noreferrer" download>{strings.DownloadModel}</a>
          </div>
        </>
      )}
    </section>
  );
}
