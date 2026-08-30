'use client';

import { useState } from 'react';
import type { BlindStructureDto } from '@poker-system/shared';
import type { CreateTournamentRequest, TournamentPrizeInput } from '@/lib/api/types';
import { Button, FormField, Input, TextLink } from '@/components/ui';

/** Mesma aparência do `Input`; não existe `Select` no design system (ver `withdrawal-form`). */
const SELECT_CLASS =
  'h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground transition-colors duration-200 hover:border-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none';

/** `datetime-local` não tem timezone — usa os getters LOCAIS (não UTC), o inverso exato de `new Date(startsAt).toISOString()` no submit. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Estado inicial para pré-popular a edição — o que já vem gravado no torneio. */
export interface TournamentFormInitial {
  name: string;
  buyIn: string;
  fee: string;
  startingStack: number;
  maxPlayers: number;
  tableCapacity: number;
  /** ISO 8601 UTC (o formato que a API devolve). */
  startsAt: string;
  blindStructureId: string | null;
  allowReentry: boolean;
  maxReentries: number | null;
  reentryUntilLevel: number | null;
  staffBonusCost: string | null;
  staffBonusChips: number | null;
  prizes: TournamentPrizeInput[];
}

/**
 * Estado + payload do form de torneio, compartilhado entre criação
 * (`CreateTournamentForm`) e edição (`EditTournamentForm`) — as ~15 variáveis
 * de campo e a montagem do payload são IDÊNTICAS nos dois; o que difere (abrir/
 * fechar, mutation, rótulo do botão) fica em cada componente.
 */
export function useTournamentFormState(initial?: TournamentFormInitial) {
  const [name, setName] = useState(initial?.name ?? '');
  const [buyIn, setBuyIn] = useState(initial?.buyIn ?? '');
  const [fee, setFee] = useState(initial?.fee ?? '');
  const [startingStack, setStartingStack] = useState(String(initial?.startingStack ?? 10_000));
  const [maxPlayers, setMaxPlayers] = useState(String(initial?.maxPlayers ?? 9));
  const [tableCapacity, setTableCapacity] = useState(String(initial?.tableCapacity ?? 9));
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? toDatetimeLocalValue(initial.startsAt) : '',
  );
  /** Vazio = torneio sem preset de blinds (o backend aceita, é retrocompatível). */
  const [blindStructureId, setBlindStructureId] = useState(initial?.blindStructureId ?? '');
  const [allowReentry, setAllowReentry] = useState(initial?.allowReentry ?? false);
  const [maxReentries, setMaxReentries] = useState(
    initial?.maxReentries ? String(initial.maxReentries) : '',
  );
  const [reentryUntilLevel, setReentryUntilLevel] = useState(
    initial?.reentryUntilLevel ? String(initial.reentryUntilLevel) : '',
  );
  /** Custo e fichas do bônus de staff só viajam juntos — um checkbox só, como `allowReentry`. */
  const [offersStaffBonus, setOffersStaffBonus] = useState(initial?.staffBonusCost != null);
  const [staffBonusCost, setStaffBonusCost] = useState(initial?.staffBonusCost ?? '');
  const [staffBonusChips, setStaffBonusChips] = useState(
    initial?.staffBonusChips ? String(initial.staffBonusChips) : '',
  );
  // Grade de premiação: índice 0 = 1º lugar, índice 1 = 2º lugar, e assim por
  // diante — a colocação é sempre a posição no array, então não há campo de
  // posição separado para o admin preencher.
  const [prizePercentages, setPrizePercentages] = useState<string[]>(
    initial?.prizes.length
      ? [...initial.prizes].sort((a, b) => a.position - b.position).map((p) => p.percentage)
      : ['100.00'],
  );

  function updatePrize(index: number, value: string) {
    setPrizePercentages((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  /** Monta o payload de `POST`/`PATCH` — mesmos campos, `CreateTournamentRequest` cobre os dois (`PATCH` os manda como `Partial`). */
  function toPayload(): CreateTournamentRequest {
    return {
      name,
      buyIn,
      fee,
      startingStack: Number(startingStack),
      maxPlayers: Number(maxPlayers),
      tableCapacity: Number(tableCapacity),
      startsAt: new Date(startsAt).toISOString(),
      // Campos opcionais só viajam quando preenchidos: `undefined` some do
      // JSON e o backend aplica o próprio default (ou não mexe, no PATCH).
      blindStructureId: blindStructureId || undefined,
      allowReentry,
      maxReentries: allowReentry && maxReentries ? Number(maxReentries) : undefined,
      reentryUntilLevel: allowReentry && reentryUntilLevel ? Number(reentryUntilLevel) : undefined,
      staffBonusCost: offersStaffBonus ? staffBonusCost : undefined,
      staffBonusChips: offersStaffBonus ? Number(staffBonusChips) : undefined,
      prizes: prizePercentages.map((percentage, index) => ({
        position: index + 1,
        percentage,
      })),
    };
  }

  return {
    fields: {
      name,
      buyIn,
      fee,
      startingStack,
      maxPlayers,
      tableCapacity,
      startsAt,
      blindStructureId,
      allowReentry,
      maxReentries,
      reentryUntilLevel,
      offersStaffBonus,
      staffBonusCost,
      staffBonusChips,
      prizePercentages,
    },
    setters: {
      setName,
      setBuyIn,
      setFee,
      setStartingStack,
      setMaxPlayers,
      setTableCapacity,
      setStartsAt,
      setBlindStructureId,
      setAllowReentry,
      setMaxReentries,
      setReentryUntilLevel,
      setOffersStaffBonus,
      setStaffBonusCost,
      setStaffBonusChips,
      setPrizePercentages,
    },
    updatePrize,
    toPayload,
  };
}

export type TournamentFormState = ReturnType<typeof useTournamentFormState>;

/** IDs dos campos, sufixados por quem instancia (`idPrefix`) — evita `id` duplicado quando criar e editar coexistem na mesma página. */
export function TournamentFormFields({
  idPrefix,
  state,
  blindStructures,
}: {
  idPrefix: string;
  state: TournamentFormState;
  blindStructures: BlindStructureDto[] | undefined;
}) {
  const { fields, setters, updatePrize } = state;
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  return (
    <>
      <FormField label="Nome" htmlFor={id('name')} className="sm:col-span-2">
        <Input
          id={id('name')}
          required
          value={fields.name}
          onChange={(e) => setters.setName(e.target.value)}
        />
      </FormField>

      <FormField label="Buy-in" htmlFor={id('buyin')}>
        <Input
          id={id('buyin')}
          inputMode="decimal"
          placeholder="90.00"
          required
          value={fields.buyIn}
          onChange={(e) => setters.setBuyIn(e.target.value)}
        />
      </FormField>

      <FormField label="Taxa (fee)" htmlFor={id('fee')}>
        <Input
          id={id('fee')}
          inputMode="decimal"
          placeholder="10.00"
          required
          value={fields.fee}
          onChange={(e) => setters.setFee(e.target.value)}
        />
      </FormField>

      <FormField label="Fichas iniciais" htmlFor={id('stack')}>
        <Input
          id={id('stack')}
          type="number"
          min={1}
          required
          value={fields.startingStack}
          onChange={(e) => setters.setStartingStack(e.target.value)}
        />
      </FormField>

      <FormField label="Máximo de jogadores" htmlFor={id('max-players')}>
        <Input
          id={id('max-players')}
          type="number"
          min={2}
          required
          value={fields.maxPlayers}
          onChange={(e) => setters.setMaxPlayers(e.target.value)}
        />
      </FormField>

      <FormField label="Jogadores por mesa" htmlFor={id('table-capacity')}>
        <Input
          id={id('table-capacity')}
          type="number"
          min={2}
          max={10}
          required
          value={fields.tableCapacity}
          onChange={(e) => setters.setTableCapacity(e.target.value)}
        />
      </FormField>

      <FormField label="Estrutura de blinds (opcional)" htmlFor={id('blind-structure')}>
        <select
          id={id('blind-structure')}
          className={SELECT_CLASS}
          value={fields.blindStructureId}
          onChange={(e) => setters.setBlindStructureId(e.target.value)}
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

      <FormField label="Início" htmlFor={id('starts-at')} className="sm:col-span-2">
        <Input
          id={id('starts-at')}
          type="datetime-local"
          required
          value={fields.startsAt}
          onChange={(e) => setters.setStartsAt(e.target.value)}
        />
      </FormField>

      <div className="flex flex-col gap-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={fields.allowReentry}
            onChange={(e) => setters.setAllowReentry(e.target.checked)}
          />
          Permite reentry
        </label>

        {/* Os dois limites só existem quando há reentry; ambos opcionais —
            vazio = ilimitado / sem corte, como no backend. */}
        {fields.allowReentry && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Máximo de reentradas (opcional)" htmlFor={id('max-reentries')}>
              <Input
                id={id('max-reentries')}
                type="number"
                min={1}
                value={fields.maxReentries}
                onChange={(e) => setters.setMaxReentries(e.target.value)}
              />
            </FormField>
            <FormField label="Reentry até o nível (opcional)" htmlFor={id('reentry-until')}>
              <Input
                id={id('reentry-until')}
                type="number"
                min={1}
                value={fields.reentryUntilLevel}
                onChange={(e) => setters.setReentryUntilLevel(e.target.value)}
              />
            </FormField>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={fields.offersStaffBonus}
            onChange={(e) => setters.setOffersStaffBonus(e.target.checked)}
          />
          Oferece bônus de staff (staff add-on)
        </label>

        {/* Taxa OPCIONAL por jogador que vai para a equipe (não entra no
            prize pool, como a fee) — quem paga leva fichas extras. */}
        {fields.offersStaffBonus && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Custo do bônus" htmlFor={id('staff-bonus-cost')}>
              <Input
                id={id('staff-bonus-cost')}
                inputMode="decimal"
                placeholder="5.00"
                required
                value={fields.staffBonusCost}
                onChange={(e) => setters.setStaffBonusCost(e.target.value)}
              />
            </FormField>
            <FormField label="Fichas extras" htmlFor={id('staff-bonus-chips')}>
              <Input
                id={id('staff-bonus-chips')}
                type="number"
                min={1}
                required
                value={fields.staffBonusChips}
                onChange={(e) => setters.setStaffBonusChips(e.target.value)}
              />
            </FormField>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <p className="text-sm font-medium text-foreground">
          Grade de premiação (percentual do prize pool, precisa somar 100%)
        </p>
        {fields.prizePercentages.map((percentage, index) => (
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
            {fields.prizePercentages.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  setters.setPrizePercentages((prev) => prev.filter((_, i) => i !== index))
                }
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
          onClick={() => setters.setPrizePercentages((prev) => [...prev, ''])}
        >
          + Colocação premiada
        </Button>
      </div>
    </>
  );
}
