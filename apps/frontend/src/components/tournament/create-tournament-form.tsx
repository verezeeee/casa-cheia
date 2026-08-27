'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { blindStructureApi } from '@/lib/api/blind-structure';
import { tournamentApi } from '@/lib/api/tournament';
import { Button, Card, FormField, Input, TextLink, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';

/** Mesma aparência do `Input`; não existe `Select` no design system (ver `withdrawal-form`). */
const SELECT_CLASS =
  'h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground transition-colors duration-200 hover:border-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none';

/** Visível apenas para ADMIN — o botão que a renderiza já checa `session.user.role`. */
export function CreateTournamentForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [buyIn, setBuyIn] = useState('');
  const [fee, setFee] = useState('');
  const [startingStack, setStartingStack] = useState('10000');
  const [maxPlayers, setMaxPlayers] = useState('9');
  const [tableCapacity, setTableCapacity] = useState('9');
  const [startsAt, setStartsAt] = useState('');
  /** Vazio = torneio sem preset de blinds (o backend aceita, é retrocompatível). */
  const [blindStructureId, setBlindStructureId] = useState('');
  const [allowReentry, setAllowReentry] = useState(false);
  const [maxReentries, setMaxReentries] = useState('');
  const [reentryUntilLevel, setReentryUntilLevel] = useState('');
  // Grade de premiação: índice 0 = 1º lugar, índice 1 = 2º lugar, e assim por
  // diante — a colocação é sempre a posição no array, então não há campo de
  // posição separado para o admin preencher.
  const [prizePercentages, setPrizePercentages] = useState<string[]>(['100.00']);
  const [error, setError] = useState<string | null>(null);

  // `enabled: open`: o form fechado é só um botão — não vale buscar o catálogo
  // em toda visita de admin ao lobby de torneios.
  const { data: blindStructures } = useQuery({
    queryKey: ['blind-structures'],
    queryFn: () => blindStructureApi.listBlindStructures(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      tournamentApi.createTournament({
        name,
        buyIn,
        fee,
        startingStack: Number(startingStack),
        maxPlayers: Number(maxPlayers),
        tableCapacity: Number(tableCapacity),
        startsAt: new Date(startsAt).toISOString(),
        // Campos opcionais só viajam quando preenchidos: `undefined` some do
        // JSON e o backend aplica o próprio default.
        blindStructureId: blindStructureId || undefined,
        allowReentry,
        maxReentries: allowReentry && maxReentries ? Number(maxReentries) : undefined,
        reentryUntilLevel:
          allowReentry && reentryUntilLevel ? Number(reentryUntilLevel) : undefined,
        prizes: prizePercentages.map((percentage, index) => ({
          position: index + 1,
          percentage,
        })),
      }),
    onSuccess: () => {
      setError(null);
      setOpen(false);
      setName('');
      setPrizePercentages(['100.00']);
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar o torneio.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  function updatePrize(index: number, value: string) {
    setPrizePercentages((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Criar torneio
      </Button>
    );
  }

  return (
    <Card title="Novo torneio">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Toast type="error" message={error} />
          </div>
        )}

        <FormField label="Nome" htmlFor="trn-name" className="sm:col-span-2">
          <Input id="trn-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <FormField label="Buy-in" htmlFor="trn-buyin">
          <Input
            id="trn-buyin"
            inputMode="decimal"
            placeholder="90.00"
            required
            value={buyIn}
            onChange={(e) => setBuyIn(e.target.value)}
          />
        </FormField>

        <FormField label="Taxa (fee)" htmlFor="trn-fee">
          <Input
            id="trn-fee"
            inputMode="decimal"
            placeholder="10.00"
            required
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </FormField>

        <FormField label="Fichas iniciais" htmlFor="trn-stack">
          <Input
            id="trn-stack"
            type="number"
            min={1}
            required
            value={startingStack}
            onChange={(e) => setStartingStack(e.target.value)}
          />
        </FormField>

        <FormField label="Máximo de jogadores" htmlFor="trn-max-players">
          <Input
            id="trn-max-players"
            type="number"
            min={2}
            required
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(e.target.value)}
          />
        </FormField>

        <FormField label="Jogadores por mesa" htmlFor="trn-table-capacity">
          <Input
            id="trn-table-capacity"
            type="number"
            min={2}
            max={10}
            required
            value={tableCapacity}
            onChange={(e) => setTableCapacity(e.target.value)}
          />
        </FormField>

        <FormField label="Estrutura de blinds (opcional)" htmlFor="trn-blind-structure">
          <select
            id="trn-blind-structure"
            className={SELECT_CLASS}
            value={blindStructureId}
            onChange={(e) => setBlindStructureId(e.target.value)}
          >
            <option value="">Sem estrutura</option>
            {blindStructures?.map((structure) => (
              <option key={structure.id} value={structure.id}>
                {structure.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            {blindStructures?.length === 0
              ? 'Nenhuma estrutura cadastrada — crie uma em '
              : 'Gerencie os presets em '}
            <TextLink href="/blind-structures">Estruturas de blinds</TextLink>.
          </p>
        </FormField>

        <FormField label="Início" htmlFor="trn-starts-at" className="sm:col-span-2">
          <Input
            id="trn-starts-at"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </FormField>

        <div className="flex flex-col gap-3 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={allowReentry}
              onChange={(e) => setAllowReentry(e.target.checked)}
            />
            Permite reentry
          </label>

          {/* Os dois limites só existem quando há reentry; ambos opcionais —
              vazio = ilimitado / sem corte, como no backend. */}
          {allowReentry && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Máximo de reentradas (opcional)" htmlFor="trn-max-reentries">
                <Input
                  id="trn-max-reentries"
                  type="number"
                  min={1}
                  value={maxReentries}
                  onChange={(e) => setMaxReentries(e.target.value)}
                />
              </FormField>
              <FormField label="Reentry até o nível (opcional)" htmlFor="trn-reentry-until">
                <Input
                  id="trn-reentry-until"
                  type="number"
                  min={1}
                  value={reentryUntilLevel}
                  onChange={(e) => setReentryUntilLevel(e.target.value)}
                />
              </FormField>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <p className="text-sm font-medium text-foreground">
            Grade de premiação (percentual do prize pool, precisa somar 100%)
          </p>
          {prizePercentages.map((percentage, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">{index + 1}º</span>
              <div className="min-w-0 flex-1">
                <Input
                  inputMode="decimal"
                  placeholder="40.00"
                  required
                  value={percentage}
                  onChange={(e) => updatePrize(index, e.target.value)}
                />
              </div>
              {prizePercentages.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setPrizePercentages((prev) => prev.filter((_, i) => i !== index))}
                >
                  Remover
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPrizePercentages((prev) => [...prev, ''])}
          >
            + Colocação premiada
          </Button>
        </div>

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={mutation.isPending} loadingText="Criando...">
            Criar torneio
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
