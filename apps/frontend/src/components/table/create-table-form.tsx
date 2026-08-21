'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { tableApi } from '@/lib/api/table';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';

/** Visível apenas para ADMIN — o botão que a renderiza já checa `session.user.role`. */
export function CreateTableForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [smallBlind, setSmallBlind] = useState('');
  const [bigBlind, setBigBlind] = useState('');
  const [minBuyIn, setMinBuyIn] = useState('');
  const [maxBuyIn, setMaxBuyIn] = useState('');
  const [maxSeats, setMaxSeats] = useState('6');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      tableApi.createTable({
        name,
        type: 'CASH_GAME',
        smallBlind,
        bigBlind,
        minBuyIn,
        maxBuyIn,
        maxSeats: Number(maxSeats),
      }),
    onSuccess: () => {
      setError(null);
      setOpen(false);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar a mesa.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Criar mesa
      </Button>
    );
  }

  return (
    <Card title="Nova mesa">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Toast type="error" message={error} />
          </div>
        )}

        <FormField label="Nome" htmlFor="table-name">
          <Input id="table-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <FormField label="Assentos" htmlFor="table-max-seats">
          <Input
            id="table-max-seats"
            type="number"
            min={2}
            max={10}
            required
            value={maxSeats}
            onChange={(e) => setMaxSeats(e.target.value)}
          />
        </FormField>

        <FormField label="Small blind" htmlFor="table-small-blind">
          <Input
            id="table-small-blind"
            inputMode="decimal"
            placeholder="1.00"
            required
            value={smallBlind}
            onChange={(e) => setSmallBlind(e.target.value)}
          />
        </FormField>

        <FormField label="Big blind" htmlFor="table-big-blind">
          <Input
            id="table-big-blind"
            inputMode="decimal"
            placeholder="2.00"
            required
            value={bigBlind}
            onChange={(e) => setBigBlind(e.target.value)}
          />
        </FormField>

        <FormField label="Buy-in mínimo" htmlFor="table-min-buyin">
          <Input
            id="table-min-buyin"
            inputMode="decimal"
            placeholder="40.00"
            required
            value={minBuyIn}
            onChange={(e) => setMinBuyIn(e.target.value)}
          />
        </FormField>

        <FormField label="Buy-in máximo" htmlFor="table-max-buyin">
          <Input
            id="table-max-buyin"
            inputMode="decimal"
            placeholder="200.00"
            required
            value={maxBuyIn}
            onChange={(e) => setMaxBuyIn(e.target.value)}
          />
        </FormField>

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={mutation.isPending} loadingText="Criando...">
            Criar mesa
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
