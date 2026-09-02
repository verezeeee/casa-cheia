'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { walletApi } from '@/lib/api/wallet';
import type { RequestWithdrawalRequest } from '@/lib/api/types';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { maskCnpj, maskCpf, maskPhone, onlyDigits } from '@/lib/masks';

const PIX_KEY_TYPES: RequestWithdrawalRequest['pixKeyType'][] = [
  'CPF',
  'CNPJ',
  'EMAIL',
  'PHONE',
  'RANDOM',
];

/**
 * Máscara aplicada à chave PIX conforme o tipo selecionado — CPF/CNPJ/telefone
 * têm formato fixo; e-mail e chave aleatória ficam em texto livre.
 */
const PIX_KEY_MASKS: Partial<
  Record<RequestWithdrawalRequest['pixKeyType'], (value: string) => string>
> = {
  CPF: maskCpf,
  CNPJ: maskCnpj,
  PHONE: maskPhone,
};

export function WithdrawalForm() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState<RequestWithdrawalRequest['pixKeyType']>('EMAIL');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const pixKeyMask = PIX_KEY_MASKS[pixKeyType];

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
            onChange={(event) => {
              // Troca de tipo descarta a chave anterior: um CPF mascarado não
              // faz sentido como texto de e-mail, e vice-versa.
              setPixKeyType(event.target.value as RequestWithdrawalRequest['pixKeyType']);
              setPixKey('');
            }}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground transition-colors duration-200 hover:border-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none"
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
            value={pixKeyMask ? pixKeyMask(pixKey) : pixKey}
            onChange={(event) =>
              setPixKey(
                pixKeyMask
                  ? onlyDigits(event.target.value, pixKeyType === 'CNPJ' ? 14 : 11)
                  : event.target.value,
              )
            }
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
