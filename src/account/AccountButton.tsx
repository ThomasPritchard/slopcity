import type { ReactNode } from 'react';
import { useAccount } from './AccountProvider';

export function AccountButton({ className = '', children }: { className?: string; children?: ReactNode }) {
 const { status, open } = useAccount();
 return <button type="button" className={`account-button ${className}`} onClick={open} aria-haspopup="dialog">
  {children ?? (status?.kind === 'member' ? 'Your account' : status?.kind === 'guest' ? 'Save your progress' : 'Sign in')}
 </button>;
}
