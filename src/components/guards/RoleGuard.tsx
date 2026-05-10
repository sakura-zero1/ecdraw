import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/useAuth';
import type { UserRole } from '../../services/unifiedClient';

interface Props {
  children: ReactNode;
  roles: UserRole[];
}

export default function RoleGuard({ children, roles }: Props) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const hasAccess = roles.some((r) => user.roles.includes(r));
  if (!hasAccess) return <Navigate to="/" replace />;
  return <>{children}</>;
}
