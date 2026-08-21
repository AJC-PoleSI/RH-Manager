"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { useRouter } from "next/navigation";

interface AuthState {
  token: string | null;
  user: any | null; // member or candidate
  role: "member" | "candidate" | null;
  isInitialized: boolean;
  loginMember: (token: string, member: any) => void;
  loginCandidate: (token: string, candidate: any) => void;
  /** Met à jour l'utilisateur en session (état + localStorage). */
  updateUser: (patch: Record<string, any>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  role: null,
  isInitialized: false,
  loginMember: () => {},
  loginCandidate: () => {},
  updateUser: () => {},
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [role, setRole] = useState<"member" | "candidate" | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const router = useRouter();

  const restoreAuthFromStorage = () => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    const storedRole = localStorage.getItem("role") as "member" | "candidate";

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      setRole(storedRole);
    } else {
      setToken(null);
      setUser(null);
      setRole(null);
    }
    setIsInitialized(true);
  };

  useEffect(() => {
    // Initial restore from localStorage on mount
    restoreAuthFromStorage();

    // Handle bfcache restoration (back/forward button)
    const handlePageShow = () => {
      restoreAuthFromStorage();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const loginMember = (newToken: string, member: any) => {
    setToken(newToken);
    setUser(member);
    setRole("member");
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(member));
    localStorage.setItem("role", "member");
    router.push("/dashboard");
  };

  const loginCandidate = (newToken: string, candidate: any) => {
    setToken(newToken);
    setUser(candidate);
    setRole("candidate");
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(candidate));
    localStorage.setItem("role", "candidate");
    router.push("/candidates/dashboard");
  };

  const updateUser = (patch: Record<string, any>) => {
    setUser((prev: any) => {
      const nextUser = { ...(prev || {}), ...patch };
      localStorage.setItem("user", JSON.stringify(nextUser));
      return nextUser;
    });
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setRole(null);
    localStorage.clear();
    router.push("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        role,
        isInitialized,
        loginMember,
        loginCandidate,
        updateUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
