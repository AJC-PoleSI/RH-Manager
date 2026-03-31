"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

interface AuthState {
    token: string | null;
    user: any | null; // member or candidate
    role: 'member' | 'candidate' | null;
    isInitialized: boolean;
    loginMember: (token: string, member: any) => void;
    loginCandidate: (token: string, candidate: any) => void;
    logout: () => void;
}

const AuthContext = createContext<AuthState>({
    token: null,
    user: null,
    role: null,
    isInitialized: false,
    loginMember: () => { },
    loginCandidate: () => { },
    logout: () => { },
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [token, setToken] = useState<string | null>(null);
    const [user, setUser] = useState<any | null>(null);
    const [role, setRole] = useState<'member' | 'candidate' | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // Restore from localStorage
        const storedToken = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        const storedRole = localStorage.getItem('role') as 'member' | 'candidate';

        if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
            setRole(storedRole);
        }
        setIsInitialized(true);
    }, []);

    const loginMember = (newToken: string, member: any) => {
        setToken(newToken);
        setUser(member);
        setRole('member');
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(member));
        localStorage.setItem('role', 'member');
        router.push('/dashboard');
    };

    const loginCandidate = (newToken: string, candidate: any) => {
        setToken(newToken);
        setUser(candidate);
        setRole('candidate');
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(candidate));
        localStorage.setItem('role', 'candidate');
        router.push('/candidates/dashboard');
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        setRole(null);
        localStorage.clear();
        router.push('/login');
    };

    return (
        <AuthContext.Provider value={{ token, user, role, isInitialized, loginMember, loginCandidate, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
