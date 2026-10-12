import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps one broken page from blanking the whole app (FD §1: no white screens). */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Kryptoniq UI error', error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey: string }): void {
    // Navigating to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="panel max-w-[70ch] p-5">
        <h2 className="text-[16px] font-semibold">Pagina nu a putut fi afișată</h2>
        <p className="mt-2 text-[13px] text-muted">{this.state.error.message}</p>
        <button className="btn mt-4" onClick={() => window.location.reload()}>
          Reîncarcă pagina
        </button>
      </div>
    );
  }
}
