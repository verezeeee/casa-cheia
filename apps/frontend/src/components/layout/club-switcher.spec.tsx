import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { ClubSwitcher } from './club-switcher';

jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/lib/api/club-context', () => ({
  clubApi: { createClube: jest.fn(), joinClube: jest.fn() },
}));

const mockedUseSession = jest.mocked(useSession);

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ClubSwitcher', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('lista os clubes do usuário e troca o clube atual ao selecionar outro', () => {
    const switchClube = jest.fn();
    mockedUseSession.mockReturnValue({
      clubes: [
        { id: 'clube-1', name: 'Casa Cheia', status: 'ACTIVE', role: 'ADMIN' },
        { id: 'clube-2', name: 'Outro Clube', status: 'ACTIVE', role: 'PLAYER' },
      ],
      currentClubeId: 'clube-1',
      switchClube,
    } as never);

    renderWithClient(<ClubSwitcher />);

    const select = screen.getByLabelText('Clube atual');
    expect(select).toHaveValue('clube-1');
    expect(screen.getByText('Outro Clube')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'clube-2' } });
    expect(switchClube).toHaveBeenCalledWith('clube-2');
  });

  it('sem clube nenhum, esconde o seletor mas mantém os gatilhos de criar/entrar', () => {
    mockedUseSession.mockReturnValue({
      clubes: [],
      currentClubeId: null,
      switchClube: jest.fn(),
    } as never);

    renderWithClient(<ClubSwitcher />);

    expect(screen.queryByLabelText('Clube atual')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Criar clube' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar com código' })).toBeInTheDocument();
  });
});
