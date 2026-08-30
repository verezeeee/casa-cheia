'use client';

import { Check, Copy } from '@phosphor-icons/react';
import { ClubeMembershipStatus, ClubeRole, type ClubeMembershipDto } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { clubMembersApi } from '@/lib/api/club';
import {
  Badge,
  type BadgeVariant,
  Button,
  Card,
  ErrorState,
  FormField,
  Input,
  Skeleton,
  Toast,
} from '@/components/ui';
import { ApiError } from '@/lib/http-client';

/** Mesma aparência do `Input`; não existe `Select` no design system (ver `tournament-form-fields`). */
const SELECT_CLASS =
  'h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground transition-colors duration-200 hover:border-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none';

const ROLE_LABEL: Record<ClubeRole, string> = {
  [ClubeRole.ADMIN]: 'Administrador',
  [ClubeRole.CASHIER]: 'Caixa',
  [ClubeRole.TOURNAMENT_DIRECTOR]: 'Diretor de torneio',
  [ClubeRole.PLAYER]: 'Jogador',
};

const STATUS_VARIANT: Record<ClubeMembershipStatus, BadgeVariant> = {
  [ClubeMembershipStatus.ACTIVE]: 'success',
  [ClubeMembershipStatus.REVOKED]: 'neutral',
};

const COPIED_FEEDBACK_MS = 2_000;

export function ClubMembersManager() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClubeRole>(ClubeRole.PLAYER);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ClubeMembershipDto | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimeoutRef.current), []);

  const {
    data: members,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['club-members'],
    queryFn: () => clubMembersApi.listMembers(),
  });

  const mutation = useMutation({
    // Só o modo "cadastrar usuário novo" — vincular alguém que já tem conta
    // exigiria buscar o userId dele, sem tela de busca ainda (fora do escopo
    // desta primeira versão).
    mutationFn: () => clubMembersApi.upsertMember({ email, name, role }),
    onSuccess: (result) => {
      setError(null);
      setCreated(result);
      setName('');
      setEmail('');
      setRole(ClubeRole.PLAYER);
      void queryClient.invalidateQueries({ queryKey: ['club-members'] });
    },
    onError: (caught: unknown) => {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível cadastrar o membro.',
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreated(null);
    mutation.mutate();
  }

  async function handleCopyPassword() {
    if (!created?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard API pode falhar (permissão, navegador antigo) — a senha já
      // fica visível na tela para cópia manual, então a falha aqui é silenciosa.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {created?.temporaryPassword && (
        // Tratamento de "canhoto de recibo": mesma linguagem de
        // `DepositForm` para um valor que só existe nesta resposta e nunca
        // mais é recuperável — o admin precisa copiar AGORA.
        <Card title="Membro cadastrado">
          <p className="text-sm text-muted">
            Senha temporária de <strong className="text-foreground">{created.name}</strong> — copie
            e repasse agora. Ela não aparece de novo.
          </p>
          <p className="font-mono mt-2 rounded-lg border border-border bg-background p-2 text-sm break-all">
            {created.temporaryPassword}
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            fullWidth
            onClick={() => void handleCopyPassword()}
          >
            {copied ? (
              <Check weight="bold" size={16} aria-hidden="true" />
            ) : (
              <Copy weight="regular" size={16} aria-hidden="true" />
            )}
            {copied ? 'Senha copiada' : 'Copiar senha'}
          </Button>
        </Card>
      )}

      <Card title="Cadastrar novo membro">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <Toast type="error" message={error} />
            </div>
          )}

          <FormField label="Nome" htmlFor="member-name">
            <Input
              id="member-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField label="E-mail" htmlFor="member-email">
            <Input
              id="member-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          <FormField label="Papel" htmlFor="member-role" className="sm:col-span-2">
            <select
              id="member-role"
              className={SELECT_CLASS}
              value={role}
              onChange={(e) => setRole(e.target.value as ClubeRole)}
            >
              {Object.values(ClubeRole).map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABEL[value]}
                </option>
              ))}
            </select>
          </FormField>

          <Button
            type="submit"
            className="sm:col-span-2"
            loading={mutation.isPending}
            loadingText="Cadastrando..."
          >
            Cadastrar
          </Button>
        </form>
      </Card>

      <Card title="Membros">
        {isLoading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        )}
        {isError && <ErrorState description="Não foi possível carregar os membros." />}
        {members && (
          <ul className="flex flex-col divide-y divide-border">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted">
                    {member.email} · {ROLE_LABEL[member.role]}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[member.status]}>{member.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
