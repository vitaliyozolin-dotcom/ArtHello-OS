import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Lock, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [loginStr, setLoginStr] = useState('owner');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await login(loginStr, password);
    setLoading(false);
    if (err) setError(err);
  }

  return (
    <div className="min-h-screen bg-[#F7F8FB] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo block */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600 shadow-lg shadow-violet-200 mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ArtHello</h1>
          <p className="text-sm text-gray-400 mt-1">Финансовая операционная система</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Войти в систему</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Role selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Пользователь</label>
              <select
                value={loginStr}
                onChange={(e) => setLoginStr(e.target.value)}
                className="w-full bg-[#F7F8FB] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="owner">Владелец</option>
                <option value="accountant">Бухгалтер</option>
                <option value="viewer">Просмотр</option>
              </select>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Пароль</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль"
                  autoComplete="current-password"
                  className="w-full bg-[#F7F8FB] border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Войти
            </button>
          </form>

          <div className="mt-5 p-3 bg-violet-50 rounded-xl border border-violet-100">
            <p className="text-xs text-violet-700">
              Пароли не публикуются и задаются только в защищённой среде приложения.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Доступ только для авторизованных пользователей
        </p>
      </div>
    </div>
  );
}
