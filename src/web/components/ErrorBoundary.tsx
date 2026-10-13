import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isImportFailure } from '../stale.ts';

interface State {
  error: Error | null;
}

/**
 * Keeps one broken page from blanking the whole app (FD §1: no white screens). `fallback`: what to show instead of the
 * default panel (e.g. inside a window).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string; fallback?: (error: Error) => ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Sentiq UI error', error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey: string }): void {
    // Navigating to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error);
    // The page's code could not be loaded (FD-STALE): the page usually reloads by itself; say so in plain words.
    const stale = isImportFailure(this.state.error.message);
    return (
      <div role="alert" className="panel max-w-[70ch] p-5">
        <h2 className="text-[16px] font-semibold">Pagina nu a putut fi afișată</h2>
        {stale ? (
          <>
            <p className="mt-2 text-[13px] text-muted">
              Codul paginii nu s-a putut încărca (de obicei după o actualizare a aplicației sau în timp ce serverul repornește). Pagina se reîncarcă singură când serverul răspunde;
              dacă nu se întâmplă în câteva secunde, apasă butonul.
            </p>
            <p className="mt-1.5 text-[12px] break-all text-faint">{this.state.error.message}</p>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-muted">{this.state.error.message}</p>
        )}
        <button className="btn mt-4" onClick={() => window.location.reload()}>
          Reîncarcă pagina
        </button>
      </div>
    );
  }
}
