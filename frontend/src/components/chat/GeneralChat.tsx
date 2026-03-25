"use client";

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface ChatMessage {
    name: string;
    text: string;
    time: string;
    role: 'admin' | 'member' | 'candidate';
}

const DEMO_MESSAGES: ChatMessage[] = [
    { name: 'Admin AJC', text: 'Bienvenue sur la plateforme AJC Recrutement 2025 !', time: '09:58', role: 'admin' },
    { name: 'Sophie L.', text: 'Merci ! Tout est clair pour commencer.', time: '10:05', role: 'member' },
    { name: 'Alice M.', text: 'Bonjour à tous, hâte de commencer !', time: '10:12', role: 'candidate' },
    { name: 'Marc D.', text: 'Bon courage à tous les candidats !', time: '10:18', role: 'member' },
];

export default function GeneralChat() {
    const { user, role } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>(DEMO_MESSAGES);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const isAdmin = role === 'member' && user?.isAdmin;

    const getCurrentRole = (): 'admin' | 'member' | 'candidate' => {
        if (role === 'candidate') return 'candidate';
        if (isAdmin) return 'admin';
        return 'member';
    };

    const getCurrentName = (): string => {
        if (!user) return 'Utilisateur';
        if (role === 'candidate') {
            return `${user.firstName || user.prenom || ''} ${(user.lastName || user.nom || '').charAt(0)}.`.trim();
        }
        return `${user.firstName || user.prenom || ''} ${(user.lastName || user.nom || '').charAt(0)}.`.trim() || 'Membre';
    };

    const handleSend = () => {
        if (!input.trim()) return;
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const newMessage: ChatMessage = {
            name: getCurrentName(),
            text: input.trim(),
            time,
            role: getCurrentRole(),
        };
        setMessages((prev) => [...prev, newMessage]);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const getBubbleStyle = (msgRole: 'admin' | 'member' | 'candidate') => {
        switch (msgRole) {
            case 'admin':
                return {
                    bg: 'bg-[#2563EB]',
                    text: 'text-white',
                    meta: 'text-white/65',
                    align: 'justify-end',
                    radius: 'rounded-[12px_12px_2px_12px]',
                };
            case 'member':
                return {
                    bg: 'bg-[#FFF0F3]',
                    text: 'text-[#E8446A]',
                    meta: 'text-[#E8446A]/65',
                    align: 'justify-start',
                    radius: 'rounded-[12px_12px_12px_2px]',
                };
            case 'candidate':
                return {
                    bg: 'bg-[#F3F4F6]',
                    text: 'text-[#374151]',
                    meta: 'text-[#374151]/65',
                    align: 'justify-start',
                    radius: 'rounded-[12px_12px_12px_2px]',
                };
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-2xl font-bold text-gray-900">Chat g&eacute;n&eacute;ral</h1>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB] inline-block" />
                        Admin
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#E8446A] inline-block" />
                        Membres JE
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#9CA3AF] inline-block" />
                        Candidats
                    </span>
                </div>
            </div>

            {/* Chat Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col">
                {/* Messages Area */}
                <div className="h-[460px] overflow-y-auto p-5 space-y-4">
                    {messages.map((msg, i) => {
                        const style = getBubbleStyle(msg.role);
                        return (
                            <div key={i} className={`flex ${style.align}`}>
                                <div className={`max-w-[70%] ${style.bg} ${style.radius} px-4 py-2.5`}>
                                    <p className={`text-sm ${style.text}`}>{msg.text}</p>
                                    <p className={`text-[11px] mt-1 ${style.meta}`}>
                                        {msg.name} &middot; {msg.time}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Bar */}
                <div className="border-t border-gray-200 p-4 flex gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="&Eacute;crivez votre message..."
                        className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim()}
                        className="bg-[#2563EB] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Envoyer
                    </button>
                </div>
            </div>
        </div>
    );
}
