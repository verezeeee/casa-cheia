import { ClubeMembershipStatus, ClubeRole } from '@poker-system/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { clubMembersApi } from '@/lib/api/club';
import { ClubMembersManager } from './club-members-manager';

jest.mock('@/lib/api/club', () => ({
  clubMembersApi: { listMembers: jest.fn(), upsertMember: jest.fn() },
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const ADMIN_MEMBER = {
  id: 'mem-1',
  userId: 'user-1',
  name: 'Admin',
  email: 'admin@casa.dev',
  role: ClubeRole.ADMIN,
  status: ClubeMembershipStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('ClubMembersManager', () => {
  beforeEach(() => {
    (clubMembersApi.listMembers as jest.Mock).mockResolvedValue([ADMIN_MEMBER]);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('lista os membros atuais', async () => {
    renderWithClient(<ClubMembersManager />);

    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
    expect(screen.getByText(/admin@casa.dev/)).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('cadastra um membro novo e mostra a senha temporária pra copiar', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    (clubMembersApi.upsertMember as jest.Mock).mockResolvedValue({
      id: 'mem-2',
      userId: 'user-2',
      name: 'Jogador Novo',
      email: 'jogador@casa.dev',
      role: ClubeRole.PLAYER,
      status: ClubeMembershipStatus.ACTIVE,
      createdAt: '2026-01-02T00:00:00.000Z',
      temporaryPassword: 'senhaTemp123',
    });

    renderWithClient(<ClubMembersManager />);
    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Jogador Novo' } });
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'jogador@casa.dev' },
    });
    fireEvent.click(screen.getByText('Cadastrar'));

    await waitFor(() =>
      expect(clubMembersApi.upsertMember).toHaveBeenCalledWith({
        email: 'jogador@casa.dev',
        name: 'Jogador Novo',
        role: ClubeRole.PLAYER,
      }),
    );
    await waitFor(() => expect(screen.getByText('senhaTemp123')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Copiar senha'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('senhaTemp123'));
    await waitFor(() => expect(screen.getByText('Senha copiada')).toBeInTheDocument());
  });

  it('envia o papel selecionado', async () => {
    (clubMembersApi.upsertMember as jest.Mock).mockResolvedValue({
      ...ADMIN_MEMBER,
      id: 'mem-3',
      userId: 'user-3',
      role: ClubeRole.CASHIER,
    });

    renderWithClient(<ClubMembersManager />);
    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Caixa Novo' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'caixa@casa.dev' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: ClubeRole.CASHIER } });
    fireEvent.click(screen.getByText('Cadastrar'));

    await waitFor(() =>
      expect(clubMembersApi.upsertMember).toHaveBeenCalledWith(
        expect.objectContaining({ role: ClubeRole.CASHIER }),
      ),
    );
  });

  it('mostra o erro da API quando o cadastro falha', async () => {
    (clubMembersApi.upsertMember as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<ClubMembersManager />);
    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'x@casa.dev' } });
    fireEvent.click(screen.getByText('Cadastrar'));

    await waitFor(() =>
      expect(screen.getByText('Não foi possível cadastrar o membro.')).toBeInTheDocument(),
    );
  });

  it('mostra erro quando a listagem falha', async () => {
    (clubMembersApi.listMembers as jest.Mock).mockRejectedValue(new Error('falhou'));

    renderWithClient(<ClubMembersManager />);

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar os membros.')).toBeInTheDocument(),
    );
  });
});
