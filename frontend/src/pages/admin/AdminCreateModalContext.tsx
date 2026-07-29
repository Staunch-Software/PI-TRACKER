import { createContext, useContext, useState, type ReactNode } from 'react';

interface AdminCreateModalValue {
  isUsersCreateOpen: boolean;
  setIsUsersCreateOpen: (value: boolean) => void;
  isVesselsCreateOpen: boolean;
  setIsVesselsCreateOpen: (value: boolean) => void;
}

const AdminCreateModalContext = createContext<AdminCreateModalValue | null>(null);

export function AdminCreateModalProvider({ children }: { children: ReactNode }) {
  const [isUsersCreateOpen, setIsUsersCreateOpen] = useState(false);
  const [isVesselsCreateOpen, setIsVesselsCreateOpen] = useState(false);

  return (
    <AdminCreateModalContext.Provider
      value={{ isUsersCreateOpen, setIsUsersCreateOpen, isVesselsCreateOpen, setIsVesselsCreateOpen }}
    >
      {children}
    </AdminCreateModalContext.Provider>
  );
}

export function useAdminCreateModal() {
  const ctx = useContext(AdminCreateModalContext);
  if (!ctx) throw new Error('useAdminCreateModal must be used within AdminCreateModalProvider');
  return ctx;
}
