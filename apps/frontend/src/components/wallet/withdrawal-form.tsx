'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { walletApi } from '@/lib/api/wallet';
import type { RequestWithdrawalRequest } from '@/lib/api/types';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';

const PIX_KEY_TYPES: RequestWithdrawalRequest['pixKeyType'][] = [
  'CPF',
  'CNPJ',
  'EMAIL',
  'PHONE',
  'RANDOM',
];

export function WithdrawalForm() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState<RequestWithdrawalRequest['pixKeyType']>('EMAIL');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      walletApi.requestWithdrawal({ amount, pixKey, pixKeyType }, crypto.randomUUID()),
    onSuccess: () => {
      setError(null);
      setSuccess('Saque solicitado. O valor já foi debitado do seu saldo.');
      setAmount('');
      setPixKey('');
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    },
    onError: (caught: unknown) => {
      setSuccess(null);
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível solicitar o saque.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess(null);
    mutation.mutate();
  }

  return (
    <Card title="Sacar via PIX">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <Toast type="error" message={error} />}
        {success && <Toast type="success" message={success} />}

        <FormField label="Valor" htmlFor="withdrawal-amount">
          <Input
            id="withdrawal-amount"
            inputMode="decimal"
            placeholder="50.00"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </FormField>

        <FormField label="Tipo de chave PIX" htmlFor="withdrawal-pix-key-type">
          <select
            id="withdrawal-pix-key-type"
            value={pixKeyType}
            onChange={(event) =>
              setPixKeyType(event.target.value as RequestWithdrawalRequest['pixKeyType'])
            }
            className="h-11 w-full rounded-lg border border-slate-300 bg-background px-3 text-base text-foreground dark:border-slate-700"
          >
            {PIX_KEY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Chave PIX" htmlFor="withdrawal-pix-key">
          <Input
            id="withdrawal-pix-key"
            required
            value={pixKey}
            onChange={(event) => setPixKey(event.target.value)}
          />
        </FormField>

        <Button
          type="submit"
          variant="secondary"
          loading={mutation.isPending}
          loadingText="Solicitando..."
        >
          Solicitar saque
        </Button>
      </form>
    </Card>
  );
}
