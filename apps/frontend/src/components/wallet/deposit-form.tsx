'use client';

import type { PixChargeResponse } from '@poker-system/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { walletApi } from '@/lib/api/wallet';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { formatMoneySafe } from '@/lib/format';

export function DepositForm() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [charge, setCharge] = useState<PixChargeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => walletApi.createDeposit({ amount }, crypto.randomUUID()),
    onSuccess: (result) => {
      setCharge(result);
      setError(null);
    },
    onError: (caught: unknown) => {
      setCharge(null);
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar o depósito.');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  function handleRefreshBalance() {
    // Sem push em tempo real do webhook para o frontend nesta fase: o
    // jogador confirma o pagamento no app do banco e clica aqui para
    // conferir se o crédito já chegou.
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
  }

  return (
    <Card title="Depositar via PIX">
      {!charge ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && <Toast type="error" message={error} />}

          <FormField label="Valor" htmlFor="deposit-amount">
            <Input
              id="deposit-amount"
              inputMode="decimal"
              placeholder="50.00"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </FormField>

          <Button type="submit" loading={mutation.isPending} loadingText="Gerando cobrança...">
            Gerar QR Code PIX
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Escaneie o QR Code ou copie o código abaixo no app do seu banco. Valor:{' '}
            <strong className="font-ledger text-foreground">
              {formatMoneySafe(charge.amount)}
            </strong>
          </p>

          {charge.qrCodeImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL do gateway, não um asset do Next.
            <img
              src={charge.qrCodeImageUrl}
              alt="QR Code PIX para pagamento do depósito"
              className="mx-auto h-48 w-48"
            />
          )}

          <FormField label="Copia e cola">
            <textarea
              readOnly
              value={charge.qrCodePayload}
              className="font-mono h-20 w-full resize-none rounded-md border border-border bg-background p-2 text-xs"
            />
          </FormField>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" fullWidth onClick={handleRefreshBalance}>
              Já paguei, atualizar saldo
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setCharge(null);
                setAmount('');
              }}
            >
              Novo depósito
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
