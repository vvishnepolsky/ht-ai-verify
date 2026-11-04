import { Console } from './console/Console';
import { FlowApp } from './flow/FlowApp';

/**
 * One bundle, two surfaces. `/flow?token=…` is the public collection flow
 * (token is the only credential; no console code paths run). Everything else
 * is the worker console.
 */
export function App() {
  if (window.location.pathname.startsWith('/flow')) return <FlowApp />;
  return <Console />;
}
