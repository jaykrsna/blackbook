import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { Repo, loadVault } from './lib/repo';
import { forgetKey, loadKey } from './lib/keystore';
import type { VaultDoc } from './lib/crypto';
import type { UserMeta } from './lib/types';
import { dayOfCycle, todayISO } from './lib/cycle';
import { Ctx, type Tab } from './state';
import { SignIn } from './screens/SignIn';
import { VaultSetup, Unlock } from './screens/Vault';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';
import { AuditWizard } from './screens/Audit';
import { Plan } from './screens/Plan';
import { ReviewScreen } from './screens/Review';
import { History } from './screens/History';
import { Settings } from './screens/Settings';

type Stage =
  | { s: 'loading' }
  | { s: 'signedOut' }
  | { s: 'noVault'; user: User }
  | { s: 'locked'; user: User; vault: VaultDoc }
  | { s: 'onboarding'; user: User; repo: Repo; meta: UserMeta | null }
  | { s: 'ready'; user: User; repo: Repo; meta: UserMeta };

export default function App() {
  const [stage, setStage] = useState<Stage>({ s: 'loading' });
  const [tab, setTab] = useState<Tab>('today');

  const enter = useCallback(async (user: User, dek: CryptoKey) => {
    const repo = new Repo(user.uid, dek);
    const meta = await repo.meta();
    if (!meta?.activeCycleId || !meta.cycleStart) setStage({ s: 'onboarding', user, repo, meta });
    else setStage({ s: 'ready', user, repo, meta });
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return setStage({ s: 'signedOut' });
        const vault = await loadVault(user.uid);
        if (!vault) return setStage({ s: 'noVault', user });
        const remembered = await loadKey(user.uid).catch(() => undefined);
        if (remembered) return enter(user, remembered);
        setStage({ s: 'locked', user, vault });
      }),
    [enter]
  );

  if (stage.s === 'loading') return <div className="center quiet">Opening your notebook…</div>;
  if (stage.s === 'signedOut') return <SignIn />;
  if (stage.s === 'noVault') return <VaultSetup user={stage.user} onReady={(dek) => enter(stage.user, dek)} />;
  if (stage.s === 'locked')
    return <Unlock user={stage.user} vault={stage.vault} onReady={(dek) => enter(stage.user, dek)} />;
  if (stage.s === 'onboarding')
    return (
      <Onboarding
        user={stage.user}
        repo={stage.repo}
        meta={stage.meta}
        onDone={async () => {
          const meta = (await stage.repo.meta())!;
          setTab('audit');
          setStage({ s: 'ready', user: stage.user, repo: stage.repo, meta });
        }}
      />
    );

  const { repo, meta, user } = stage;
  const today = todayISO(meta.timezone);
  const day = dayOfCycle(meta.cycleStart!, today);

  const refresh = async () => {
    const m = await repo.meta();
    if (m) setStage({ s: 'ready', user, repo, meta: m });
  };
  const lock = async () => {
    await forgetKey(user.uid);
    const vault = await loadVault(user.uid);
    setStage(vault ? { s: 'locked', user, vault } : { s: 'signedOut' });
  };

  return (
    <Ctx.Provider value={{ repo, meta, cycleId: meta.activeCycleId!, today, day, refresh, lock, go: setTab }}>
      <div className="app">
        {tab === 'today' && <Today />}
        {tab === 'audit' && <AuditWizard />}
        {tab === 'plan' && <Plan />}
        {tab === 'review' && <ReviewScreen />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
      </div>
      <nav className="tabs">
        {(['today', 'plan', 'review', 'history', 'settings'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
    </Ctx.Provider>
  );
}
