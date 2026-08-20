import { useState } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmation) { setError('Пароли не совпадают'); return; }
    setLoading(true);
    const result = await changePassword(currentPassword, newPassword);
    setLoading(false);
    if (result) setError(result);
  }

  return (
    <div className="min-h-screen bg-[#F7F8FB] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-[22px] border border-black/[0.06] shadow-sm p-7">
        <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center mb-5">
          <LockKeyhole className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Замените временный пароль</h1>
        <p className="text-sm text-gray-500 mt-2 mb-6">До смены пароля доступ к данным и разделам системы закрыт.</p>
        <form onSubmit={submit} className="space-y-4">
          <PasswordField label="Текущий пароль" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label="Новый пароль" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField label="Повторите новый пароль" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          <p className="text-xs text-gray-400">Не менее 14 символов, обязательно буквы и цифры.</p>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
          <button type="submit" disabled={loading || !currentPassword || !newPassword || !confirmation}
            className="min-h-11 w-full flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Сохранить пароль
          </button>
          <button type="button" onClick={logout} className="min-h-11 w-full text-sm text-gray-500">Выйти</button>
        </form>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (value: string) => void; autoComplete: string;
}) {
  return <label className="block text-xs font-medium text-gray-500">
    <span className="block mb-1.5">{label}</span>
    <input type="password" value={value} onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete} required maxLength={1024}
      className="min-h-11 w-full bg-[#F7F8FB] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-300" />
  </label>;
}
