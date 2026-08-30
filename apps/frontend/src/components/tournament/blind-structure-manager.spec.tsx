import { ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { blindStructureApi } from '@/lib/api/blind-structure';
import { BlindStructureManager } from './blind-structure-manager';

jest.mock('@/lib/api/blind-structure', () => ({
  blindStructureApi: { listBlindStructures: jest.fn(), createBlindStructure: jest.fn() },
}));

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = jest.mocked(useSession);

function mockSession(clubeRole: ClubeRole) {
  mockedUseSession.mockReturnValue({
    user: { id: 'u-1', email: 'u@x.dev', name: 'U' },
    clubeRole,
    status: 'authenticated',
    login: jest.fn(),
    logout: jest.fn(),
  });
}

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('BlindStructureManager', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('bloqueia quem não é ADMIN', () => {
    mockSession(ClubeRole.PLAYER);

    renderWithClient(<BlindStructureManager />);

    expect(screen.getByText('Acesso restrito')).toBeInTheDocument();
    expect(blindStructureApi.listBlindStructures).not.toHaveBeenCalled();
  });

  it('lista as estruturas com o número de níveis', async () => {
    mockSession(ClubeRole.ADMIN);
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([
      { id: 'bs-1', name: 'Turbo 20 min', levels: [{}, {}, {}] },
    ]);

    renderWithClient(<BlindStructureManager />);

    await waitFor(() => expect(screen.getByText('Turbo 20 min')).toBeInTheDocument());
    expect(screen.getByText('3 níveis')).toBeInTheDocument();
  });

  it('cria uma estrutura com um nível e um intervalo herdando os blinds', async () => {
    mockSession(ClubeRole.ADMIN);
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([]);
    (blindStructureApi.createBlindStructure as jest.Mock).mockResolvedValue({ id: 'bs-1' });

    renderWithClient(<BlindStructureManager />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Deepstack' } });
    fireEvent.click(screen.getByText('+ Nível'));
    fireEvent.click(screen.getByLabelText('Nível 2 é intervalo'));
    fireEvent.change(screen.getByLabelText('Rótulo do intervalo'), {
      target: { value: 'Intervalo · 15 min' },
    });
    fireEvent.click(screen.getByText('Criar estrutura'));

    await waitFor(() =>
      expect(blindStructureApi.createBlindStructure).toHaveBeenCalledWith({
        name: 'Deepstack',
        levels: [
          {
            levelNumber: 1,
            smallBlind: 25,
            bigBlind: 50,
            ante: 0,
            durationSeconds: 1200,
            isBreak: false,
            breakLabel: undefined,
          },
          {
            levelNumber: 2,
            smallBlind: 25,
            bigBlind: 50,
            ante: 0,
            durationSeconds: 1200,
            isBreak: true,
            breakLabel: 'Intervalo · 15 min',
          },
        ],
      }),
    );
  });

  it('remove um nível do editor', async () => {
    mockSession(ClubeRole.ADMIN);
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([]);

    renderWithClient(<BlindStructureManager />);

    fireEvent.click(screen.getByText('+ Nível'));
    expect(screen.getByText('Nível 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remover nível 2'));
    expect(screen.queryByText('Nível 2')).not.toBeInTheDocument();
  });

  it('mostra o erro da API quando a criação falha', async () => {
    mockSession(ClubeRole.ADMIN);
    (blindStructureApi.listBlindStructures as jest.Mock).mockResolvedValue([]);
    (blindStructureApi.createBlindStructure as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<BlindStructureManager />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Deepstack' } });
    fireEvent.click(screen.getByText('Criar estrutura'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível criar a estrutura.')).toBeInTheDocument(),
    );
  });
});
