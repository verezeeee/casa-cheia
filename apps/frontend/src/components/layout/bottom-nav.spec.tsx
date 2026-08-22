import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { BottomNav } from './bottom-nav';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

const mockedUsePathname = jest.mocked(usePathname);

describe('BottomNav', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renderiza as 3 abas com os hrefs corretos', () => {
    mockedUsePathname.mockReturnValue('/lobby');
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /Mesas/ })).toHaveAttribute('href', '/lobby');
    expect(screen.getByRole('link', { name: /Torneios/ })).toHaveAttribute('href', '/tournaments');
    expect(screen.getByRole('link', { name: /Carteira/ })).toHaveAttribute('href', '/wallet');
  });

  it('marca "Mesas" como ativa em /lobby e em /tables/:id', () => {
    mockedUsePathname.mockReturnValue('/tables/table-1');
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /Mesas/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Torneios/ })).not.toHaveAttribute('aria-current');
  });

  it('marca "Torneios" como ativa em /tournaments/:id', () => {
    mockedUsePathname.mockReturnValue('/tournaments/trn-1');
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /Torneios/ })).toHaveAttribute('aria-current', 'page');
  });

  it('marca "Carteira" como ativa em /wallet', () => {
    mockedUsePathname.mockReturnValue('/wallet');
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /Carteira/ })).toHaveAttribute('aria-current', 'page');
  });
});
