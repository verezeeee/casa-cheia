'use client';

import { ClubeRole } from '@poker-system/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { blindStructureApi } from '@/lib/api/blind-structure';
import type { BlindLevelInput } from '@/lib/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Skeleton,
  Toast,
} from '@/components/ui';
import { ApiError } from '@/lib/http-client';
import {
  deriveLevelCount,
  deriveLevelDurationMinutes,
  generateBlindLevels,
} from '@/lib/blind-structure-generator';

/**
 * Linha do editor. Tudo string porque vem de `<input>`; a conversão para
 * número acontece uma vez só, no submit.
 *
 * `smallBlind`/`bigBlind` continuam existindo nas linhas de intervalo mesmo
 * com os campos escondidos: o `CHECK` do banco exige `smallBlind > 0` em TODA
 * linha, e a convenção do clube é repetir os blinds do nível anterior — que é
 * exatamente o que a linha nova já herda.
 */
interface LevelRow {
  smallBlind: string;
  bigBlind: string;
  ante: string;
  durationSeconds: string;
  isBreak: boolean;
  breakLabel: string;
}

const FIRST_ROW: LevelRow = {
  smallBlind: '25',
  bigBlind: '50',
  ante: '0',
  durationSeconds: '1200',
  isBreak: false,
  breakLabel: '',
};

function nextRow(previous: LevelRow | undefined): LevelRow {
  return { ...(previous ?? FIRST_ROW), isBreak: false, breakLabel: '' };
}

function toInput(row: LevelRow, index: number): BlindLevelInput {
  return {
    levelNumber: index + 1,
    smallBlind: Number(row.smallBlind),
    bigBlind: Number(row.bigBlind),
    ante: Number(row.ante || 0),
    durationSeconds: Number(row.durationSeconds),
    isBreak: row.isBreak,
    breakLabel: row.isBreak ? row.breakLabel : undefined,
  };
}

/** Catálogo de presets de blinds. Leitura para todos, criação só para ADMIN. */
export function BlindStructureManager() {
  const { clubeRole } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<LevelRow[]>([FIRST_ROW]);
  const [error, setError] = useState<string | null>(null);

  // Geração automática (ver `lib/blind-structure-generator.ts`): só preenche
  // `rows` acima, o resto do fluxo (revisar, editar, salvar) é o mesmo editor
  // manual de sempre.
  const [genDurationMode, setGenDurationMode] = useState<'byLevelDuration' | 'byNumLevels'>(
    'byLevelDuration',
  );
  const [genStartingStack, setGenStartingStack] = useState('10000');
  const [genEstimatedPlayers, setGenEstimatedPlayers] = useState('9');
  const [genTotalDurationMinutes, setGenTotalDurationMinutes] = useState('240');
  const [genLevelDurationMinutes, setGenLevelDurationMinutes] = useState('20');
  const [genNumLevels, setGenNumLevels] = useState('12');
  const [genBreakEveryLevels, setGenBreakEveryLevels] = useState('6');
  const [genBreakDurationMinutes, setGenBreakDurationMinutes] = useState('15');
  const [genIncludeAntes, setGenIncludeAntes] = useState(false);
  const [genAnteFromLevel, setGenAnteFromLevel] = useState('5');

  const isAdmin = clubeRole === ClubeRole.ADMIN;

  const {
    data: structures,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['blind-structures'],
    queryFn: () => blindStructureApi.listBlindStructures(),
    enabled: isAdmin,
  });

  const mutation = useMutation({
    mutationFn: () => blindStructureApi.createBlindStructure({ name, levels: rows.map(toInput) }),
    onSuccess: () => {
      setError(null);
      setName('');
      setRows([FIRST_ROW]);
      void queryClient.invalidateQueries({ queryKey: ['blind-structures'] });
    },
    onError: (caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar a estrutura.');
    },
  });

  if (!isAdmin) {
    return (
      <EmptyState
        title="Acesso restrito"
        description="Somente administradores gerenciam estruturas de blinds."
      />
    );
  }

  function updateRow(index: number, patch: Partial<LevelRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  /**
   * Preenche `rows` com uma grade calculada a partir dos parâmetros da seção
   * "Gerar automaticamente" — não salva nada, só poupa o trabalho de montar a
   * grade nível a nível no editor manual abaixo, que continua editável.
   */
  function handleGenerate() {
    const startingStack = Number(genStartingStack) || 0;
    const estimatedPlayers = Math.max(2, Number(genEstimatedPlayers) || 2);
    const totalDurationMinutes = Number(genTotalDurationMinutes) || 0;
    const breakEveryLevels = Number(genBreakEveryLevels) || 0;
    const breakDurationMinutes = Number(genBreakDurationMinutes) || 0;

    const numLevels =
      genDurationMode === 'byLevelDuration'
        ? deriveLevelCount({
            totalDurationMinutes,
            levelDurationMinutes: Number(genLevelDurationMinutes) || 1,
            breakEveryLevels: breakEveryLevels || null,
            breakDurationMinutes,
          })
        : Math.max(1, Number(genNumLevels) || 1);

    const levelDurationMinutes =
      genDurationMode === 'byLevelDuration'
        ? Number(genLevelDurationMinutes) || 1
        : deriveLevelDurationMinutes({
            totalDurationMinutes,
            numLevels,
            breakEveryLevels: breakEveryLevels || null,
            breakDurationMinutes,
          });

    setRows(
      generateBlindLevels({
        numLevels,
        levelDurationMinutes,
        startingStack,
        estimatedPlayers,
        breakEveryLevels: breakEveryLevels || null,
        breakDurationMinutes,
        includeAntes: genIncludeAntes,
        anteFromLevel: Math.max(1, Number(genAnteFromLevel) || 1),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Toast type="error" message={error} />}

      <Card title="Gerar automaticamente">
        <p className="text-sm text-muted">
          Preenche a grade abaixo a partir desses parâmetros — você ainda revisa e ajusta nível a
          nível antes de salvar.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Input
            label="Stack inicial"
            type="number"
            min={1}
            value={genStartingStack}
            onChange={(e) => setGenStartingStack(e.target.value)}
          />
          <Input
            label="Jogadores estimados"
            type="number"
            min={2}
            value={genEstimatedPlayers}
            onChange={(e) => setGenEstimatedPlayers(e.target.value)}
          />
          <Input
            label="Duração total (min)"
            type="number"
            min={1}
            value={genTotalDurationMinutes}
            onChange={(e) => setGenTotalDurationMinutes(e.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={genDurationMode === 'byLevelDuration' ? 'secondary' : 'ghost'}
            onClick={() => setGenDurationMode('byLevelDuration')}
          >
            Definir duração do nível
          </Button>
          <Button
            type="button"
            size="sm"
            variant={genDurationMode === 'byNumLevels' ? 'secondary' : 'ghost'}
            onClick={() => setGenDurationMode('byNumLevels')}
          >
            Definir nº de níveis
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {genDurationMode === 'byLevelDuration' ? (
            <Input
              label="Duração de cada nível (min)"
              type="number"
              min={1}
              value={genLevelDurationMinutes}
              onChange={(e) => setGenLevelDurationMinutes(e.target.value)}
            />
          ) : (
            <Input
              label="Nº de níveis"
              type="number"
              min={1}
              value={genNumLevels}
              onChange={(e) => setGenNumLevels(e.target.value)}
            />
          )}
          <Input
            label="Pausa a cada N níveis"
            type="number"
            min={0}
            placeholder="0 = sem pausas"
            value={genBreakEveryLevels}
            onChange={(e) => setGenBreakEveryLevels(e.target.value)}
          />
          <Input
            label="Duração da pausa (min)"
            type="number"
            min={1}
            value={genBreakDurationMinutes}
            onChange={(e) => setGenBreakDurationMinutes(e.target.value)}
          />
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={genIncludeAntes}
            onChange={(e) => setGenIncludeAntes(e.target.checked)}
          />
          Incluir antes
        </label>
        {genIncludeAntes && (
          <Input
            className="mt-2 max-w-40"
            label="A partir do nível"
            type="number"
            min={1}
            value={genAnteFromLevel}
            onChange={(e) => setGenAnteFromLevel(e.target.value)}
          />
        )}

        <Button type="button" className="mt-3" size="sm" onClick={handleGenerate}>
          Gerar
        </Button>
      </Card>

      <Card title="Nova estrutura">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FormField label="Nome" htmlFor="bs-name">
            <Input
              id="bs-name"
              required
              placeholder="Turbo 20 min"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          {rows.map((row, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-ledger text-sm font-medium">Nível {index + 1}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={row.isBreak}
                      onChange={(e) => updateRow(index, { isBreak: e.target.checked })}
                      aria-label={`Nível ${index + 1} é intervalo`}
                    />
                    Intervalo
                  </label>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remover nível ${index + 1}`}
                    >
                      Remover
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {row.isBreak ? (
                  <Input
                    label="Rótulo do intervalo"
                    className="col-span-2"
                    required
                    placeholder="Intervalo · 15 min"
                    value={row.breakLabel}
                    onChange={(e) => updateRow(index, { breakLabel: e.target.value })}
                  />
                ) : (
                  <>
                    <Input
                      label="Small blind"
                      type="number"
                      min={1}
                      required
                      value={row.smallBlind}
                      onChange={(e) => updateRow(index, { smallBlind: e.target.value })}
                    />
                    <Input
                      label="Big blind"
                      type="number"
                      min={1}
                      required
                      value={row.bigBlind}
                      onChange={(e) => updateRow(index, { bigBlind: e.target.value })}
                    />
                    <Input
                      label="Ante"
                      type="number"
                      min={0}
                      required
                      value={row.ante}
                      onChange={(e) => updateRow(index, { ante: e.target.value })}
                    />
                  </>
                )}
                {/* Em segundos, como o backend e o `clock-control`. */}
                <Input
                  label="Duração (s)"
                  type="number"
                  min={1}
                  required
                  value={row.durationSeconds}
                  onChange={(e) => updateRow(index, { durationSeconds: e.target.value })}
                />
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRows((prev) => [...prev, nextRow(prev[prev.length - 1])])}
            >
              + Nível
            </Button>
            <Button type="submit" size="sm" loading={mutation.isPending} loadingText="Criando...">
              Criar estrutura
            </Button>
          </div>
        </form>
      </Card>

      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : isError || !structures ? (
        <ErrorState description="Não foi possível carregar as estruturas." />
      ) : structures.length === 0 ? (
        <EmptyState
          title="Nenhuma estrutura"
          description="Crie a primeira acima para usá-la ao abrir um torneio."
        />
      ) : (
        <Card title="Estruturas cadastradas">
          <ul className="flex flex-col divide-y divide-border">
            {structures.map((structure) => (
              <li key={structure.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate font-medium">{structure.name}</span>
                <span className="font-ledger shrink-0 text-sm text-muted">
                  {structure.levels.length} níveis
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
