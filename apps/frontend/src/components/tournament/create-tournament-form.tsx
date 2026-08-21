'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { tournamentApi } from '@/lib/api/tournament';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';

/** Visível apenas para ADMIN — o botão que a renderiza já checa `session.user.role`. */
export function CreateTournamentForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [buyIn, setBuyIn] = useState('');
  const [fee, setFee] = useState('');
  const [startingStack, setStartingStack] = useState('10000');
  const [maxPlayers, setMaxPlayers] = useState('9');
  const [startsAt, setStartsAt] = useState('');
  // Grade de premiação: índice 0 = 1º lugar, índice 1 = 2º lugar, e assim por
  // diante — a colocação é sempre a posição no array, então não há campo de
  // posição separado para o admin preencher.
  const [prizePercentages, setPrizePercentages] = useState<string[]>(['100.00']);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      tournamentApi.createTournament({
        name,
        buyIn,
        fee,
        startingStack: Number(startingStack),
        maxPlayers: Number(maxPlayers),
        startsAt: new Date(startsAt).toISOString(),
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

        <FormField label="Início" htmlFor="trn-starts-at" className="sm:col-span-2">
          <Input
            id="trn-starts-at"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </FormField>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <p className="text-sm font-medium text-foreground">
            Grade de premiação (percentual do prize pool, precisa somar 100%)
          </p>
          {prizePercentages.map((percentage, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">{index + 1}º</span>
              <Input
                inputMode="decimal"
                placeholder="40.00"
                required
                value={percentage}
                onChange={(e) => updatePrize(index, e.target.value)}
              />
              {prizePercentages.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
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
