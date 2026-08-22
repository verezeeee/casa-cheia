'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/auth-layout';
import { useSession } from '@/components/providers/session-provider';
import { Button, Card, FormField, Input, TextLink, Toast } from '@/components/ui';
import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/http-client';

export default function RegisterPage() {
  const { login } = useSession();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Cadastro não loga automaticamente (contrato de `authApi.register`,
      // que devolve só o `SessionUser` público) — encadeia um login com as
      // mesmas credenciais para não pedir a senha duas vezes ao jogador.
      await authApi.register({ name, email, password });
      await login({ email, password });
      router.push('/lobby');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível criar a conta. Tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Criar conta</h1>
            <p className="text-sm text-muted">Cadastre-se para depositar e jogar.</p>
          </div>

          {error && <Toast type="error" message={error} />}

          <FormField label="Nome" htmlFor="register-name">
            <Input
              id="register-name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          <FormField label="E-mail" htmlFor="register-email">
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>

          <FormField label="Senha" htmlFor="register-password" hint="Mínimo de 8 caracteres.">
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>

          <Button type="submit" loading={submitting} loadingText="Criando conta..." fullWidth>
            Criar conta
          </Button>

          <p className="text-center text-sm text-muted">
            Já tem conta? <TextLink href="/login">Entrar</TextLink>
          </p>
        </form>
      </Card>
    </AuthLayout>
  );
}
