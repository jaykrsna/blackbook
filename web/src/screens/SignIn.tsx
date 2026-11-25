import { useState } from 'react';
import { signIn } from '../lib/firebase';

export function SignIn() {
  const [err, setErr] = useState('');
  return (
    <div className="center">
      <h1>Black Notebook</h1>
      <p className="quiet">
        90 days. One honest audit, three phases, a daily check-in, and Saakshi, a reviewer that only trusts evidence.
      </p>
      <p className="quiet small">
        Everything you write is encrypted on this device with a passphrase only you know. Nobody else, including the
        person who runs this app, can read it.
      </p>
      <button className="primary block" onClick={() => signIn().catch((e) => setErr(e.message))}>
        Continue with Google
      </button>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
