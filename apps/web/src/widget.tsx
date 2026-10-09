import ReactDOM from 'react-dom/client';
import { SmartCommutePlanner, type SmartCommutePlannerProps } from '@smart-commute/react';

/** Mounts an independent widget. React is bundled; no host framework required. */
export function mountSmartCommutePlanner(element: HTMLElement, props: SmartCommutePlannerProps) {
  const root = ReactDOM.createRoot(element, {
    identifierPrefix: `sc-widget-${Math.random().toString(36).slice(2)}-`,
  });
  root.render(<SmartCommutePlanner {...props} />);
  return { unmount: () => root.unmount() };
}
export { SmartCommutePlanner };
export type { SmartCommutePlannerProps };
