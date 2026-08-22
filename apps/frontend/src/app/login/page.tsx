'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';

export default function LoginPage() {
  const { login } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login({ email, password });
      router.push('/lobby');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível entrar. Tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-brand p-4 sm:p-8">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Entrar</h1>
            <p className="text-sm text-muted">Acesse sua conta da casa de poker.</p>
          </div>

          {error && <Toast type="error" message={error} />}

          <FormField label="E-mail" htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>

          <FormField label="Senha" htmlFor="login-password">
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>

          <Button type="submit" loading={submitting} loadingText="Entrando..." fullWidth>
            Entrar
          </Button>

          <p className="text-center text-sm text-muted">
            Não tem conta?{' '}
            <Link href="/register" className="font-medium text-accent hover:underline">
              Cadastre-se
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
