'use client';

import { Check, Copy } from '@phosphor-icons/react';
import type { PixChargeResponse } from '@poker-system/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { walletApi } from '@/lib/api/wallet';
import { Button, Card, FormField, Input, Toast } from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import { formatDateTimeSafe, formatMoneySafe } from '@/lib/format';

const COPIED_FEEDBACK_MS = 2_000;

export function DepositForm() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [charge, setCharge] = useState<PixChargeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimeoutRef.current), []);

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

  async function handleCopyCode() {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.qrCodePayload);
      setCopied(true);
      clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard API pode falhar (permissão, navegador antigo, contexto
      // não seguro) — o código completo já fica visível na tela para cópia
      // manual, então uma falha silenciosa aqui não bloqueia o depósito.
    }
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
        // Tratamento de "canhoto de recibo": a régua tracejada entre o QR e o
        // copia-e-cola é a mesma linguagem de perfuração do `.ledger-rule`
        // usado no resto do produto, não um clip-path novo.
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted">Escaneie o QR Code no app do seu banco.</p>
            <p className="font-ledger mt-1 text-2xl font-semibold text-foreground">
              {formatMoneySafe(charge.amount)}
            </p>
          </div>

          {charge.qrCodeImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL do gateway, não um asset do Next.
            <img
              src={charge.qrCodeImageUrl}
              alt="QR Code PIX para pagamento do depósito"
              className="mx-auto h-48 w-48 rounded-lg border border-border bg-white p-2"
            />
          )}

          <Button variant="secondary" fullWidth onClick={() => void handleCopyCode()}>
            {copied ? (
              <Check weight="bold" size={16} aria-hidden="true" />
            ) : (
              <Copy weight="regular" size={16} aria-hidden="true" />
            )}
            {copied ? 'Código copiado' : 'Copiar código PIX'}
          </Button>

          <div className="border-t border-dashed border-border pt-4">
            <p className="text-sm font-medium text-foreground">Copia e cola</p>
            <p className="font-mono mt-1.5 rounded-lg border border-border bg-background p-2 text-xs break-all">
              {charge.qrCodePayload}
            </p>
            <p className="mt-1 text-xs text-muted">
              Se a cópia automática não funcionar, selecione o código acima manualmente.
            </p>
          </div>

          <p className="text-xs text-muted">Expira às {formatDateTimeSafe(charge.expiresAt)}.</p>

          {/* Sempre em coluna, mesmo em telas largas: na /wallet este card
              divide espaço com o de saque (`sm:grid-cols-2`), então a
              largura real do card é bem menor que o viewport — um
              `sm:flex-row` aqui (baseado no viewport, não no container)
              voltava a espremer os rótulos longos lado a lado. */}
          <div className="flex flex-col gap-2">
            <Button fullWidth onClick={handleRefreshBalance}>
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
