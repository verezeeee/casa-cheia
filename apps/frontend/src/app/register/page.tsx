'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/auth-layout';
import { useSession } from '@/components/providers/session-provider';
import { Button, Card, FormField, Input, TextLink, Toast } from '@/components/ui';
import { authApi } from '@/lib/api/auth';
import { clubApi } from '@/lib/api/club-context';
import { ApiError } from '@/lib/http-client';

type ClubeMode = 'none' | 'code' | 'create';

const MODE_LABEL: Record<ClubeMode, string> = {
  none: 'Nenhum agora',
  code: 'Tenho um código',
  create: 'Criar um clube',
};

export default function RegisterPage() {
  const { login, switchClube, refreshClubes } = useSession();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Clube é opcional no cadastro (dá pra resolver depois pelo seletor da
  // sidebar/tela de "sem clube") — três modos mutuamente exclusivos.
  const [clubeMode, setClubeMode] = useState<ClubeMode>('none');
  const [clubeCode, setClubeCode] = useState('');
  const [clubeName, setClubeName] = useState('');
  const [clubeDocument, setClubeDocument] = useState('');

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

      // Etapa separada e NUNCA bloqueante: a conta já existe e já está
      // logada nesse ponto. Se entrar/criar o clube falhar (ex.: código
      // inválido), o usuário só cai na tela de "sem clube" do `/lobby` e
      // tenta de novo por lá — não desfaz o cadastro.
      if (clubeMode === 'code') {
        try {
          const clube = await clubApi.joinClube({ code: clubeCode });
          await refreshClubes();
          switchClube(clube.id);
        } catch {
          // Segue pro /lobby mesmo assim (ver comentário acima).
        }
      } else if (clubeMode === 'create') {
        try {
          const clube = await clubApi.createClube({
            name: clubeName,
            document: clubeDocument,
          });
          await refreshClubes();
          switchClube(clube.id);
        } catch {
          // Segue pro /lobby mesmo assim (ver comentário acima).
        }
      }

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

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Clube (opcional)</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MODE_LABEL) as ClubeMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={clubeMode === mode ? 'secondary' : 'ghost'}
                  onClick={() => setClubeMode(mode)}
                >
                  {MODE_LABEL[mode]}
                </Button>
              ))}
            </div>
          </div>

          {clubeMode === 'code' && (
            <FormField
              label="Código do clube"
              htmlFor="register-clube-code"
              hint="6 dígitos, fornecido pelo administrador do clube."
            >
              <Input
                id="register-clube-code"
                inputMode="numeric"
                maxLength={6}
                required
                value={clubeCode}
                onChange={(event) => setClubeCode(event.target.value.replace(/\D/g, ''))}
              />
            </FormField>
          )}

          {clubeMode === 'create' && (
            <>
              <FormField label="Nome do clube" htmlFor="register-clube-name">
                <Input
                  id="register-clube-name"
                  required
                  value={clubeName}
                  onChange={(event) => setClubeName(event.target.value)}
                />
              </FormField>
              <FormField
                label="CNPJ ou CPF do clube"
                htmlFor="register-clube-document"
                hint="Somente números, 11 (CPF) ou 14 (CNPJ) dígitos."
              >
                <Input
                  id="register-clube-document"
                  inputMode="numeric"
                  required
                  value={clubeDocument}
                  onChange={(event) => setClubeDocument(event.target.value.replace(/\D/g, ''))}
                />
              </FormField>
            </>
          )}

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
