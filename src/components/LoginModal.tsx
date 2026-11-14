import React, { useEffect, useRef, useState } from 'react';
import { Loader2, LogIn, X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
}

export default function LoginModal({ onClose, onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSignIn(email, password);
      onClose();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (/invalid login|invalid credentials/i.test(msg)) {
        setError('Email hoặc mật khẩu không đúng.');
      } else if (/fetch|network/i.test(msg)) {
        setError('Không kết nối được máy chủ. Vui lòng kiểm tra mạng.');
      } else {
        setError('Đăng nhập thất bại. Vui lòng thử lại.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-slate-100 p-6 sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          aria-label="Đóng"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-gradient-to-br from-red-500 to-red-600 w-11 h-11 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20">
            <LogIn className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-slate-900 font-semibold text-base uppercase tracking-wide">Đăng nhập</h3>
            <p className="text-slate-400 text-xs font-medium">Dành cho người được cấp quyền chỉnh sửa</p>
          </div>
        </div>

        <label className="block text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Email</label>
        <input
          ref={emailRef}
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400/40 mb-4"
        />

        <label className="block text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Mật khẩu</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
        />

        {error && (
          <div role="alert" className="mt-4 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white font-bold text-xs tracking-wide uppercase px-5 py-3.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          <span>{busy ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
        </button>
      </form>
    </div>
  );
}
