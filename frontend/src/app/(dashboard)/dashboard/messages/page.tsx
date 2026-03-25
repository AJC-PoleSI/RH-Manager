"use client";

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface Message {
    id: string;
    from: string;
    text: string;
    timestamp: Date;
    isMine: boolean;
}

interface Contact {
    id: string;
    name: string;
    type: 'candidat' | 'membre';
}

const DEMO_CONTACTS: Contact[] = [
    { id: 'c1', name: 'Alice MARTIN', type: 'candidat' },
    { id: 'c2', name: 'Baptiste DURAND', type: 'candidat' },
    { id: 'c3', name: 'Chloé PETIT', type: 'candidat' },
    { id: 'm1', name: 'Sophie LEBLANC', type: 'membre' },
    { id: 'm2', name: 'Marc DUPONT', type: 'membre' },
];

export default function MessagesPage() {
    const { user, role } = useAuth();
    const isAdmin = role === 'member' && user?.isAdmin;
    const isMember = role === 'member' && !user?.isAdmin;

    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [conversations, setConversations] = useState<Record<string, Message[]>>({});
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const currentMessages = selectedContact ? (conversations[selectedContact.id] || []) : [];

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [currentMessages.length]);

    const handleSend = () => {
        if (!inputValue.trim()) return;

        if (isAdmin && !selectedContact) return;

        const contactId = isAdmin ? selectedContact!.id : 'admin';
        const newMessage: Message = {
            id: Date.now().toString(),
            from: user?.email || user?.firstName || 'Moi',
            text: inputValue.trim(),
            timestamp: new Date(),
            isMine: true,
        };

        setConversations(prev => ({
            ...prev,
            [contactId]: [...(prev[contactId] || []), newMessage],
        }));
        setInputValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    };

    // Admin view: split layout with contact sidebar
    if (isAdmin) {
        const candidats = DEMO_CONTACTS.filter(c => c.type === 'candidat');
        const membres = DEMO_CONTACTS.filter(c => c.type === 'membre');

        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Messagerie priv&eacute;e</h1>
                    <p className="text-sm text-gray-500 mt-1">Conversations priv&eacute;es avec candidats et membres</p>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex overflow-hidden" style={{ height: '600px' }}>
                    {/* LEFT SIDEBAR */}
                    <div className="border-r border-gray-200 flex flex-col" style={{ width: '265px', minWidth: '265px' }}>
                        <div className="p-3 border-b border-gray-100 bg-gray-50">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contacts</p>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {/* Candidats section */}
                            <div className="px-3 pt-3 pb-1">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Candidats</p>
                            </div>
                            {candidats.map(contact => (
                                <button
                                    key={contact.id}
                                    onClick={() => setSelectedContact(contact)}
                                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                                        selectedContact?.id === contact.id
                                            ? 'bg-blue-50 text-blue-700 font-medium'
                                            : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                            {contact.name.charAt(0)}
                                        </span>
                                        <span className="truncate">{contact.name}</span>
                                    </div>
                                </button>
                            ))}

                            {/* Membres section */}
                            <div className="px-3 pt-4 pb-1">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Membres JE</p>
                            </div>
                            {membres.map(contact => (
                                <button
                                    key={contact.id}
                                    onClick={() => setSelectedContact(contact)}
                                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                                        selectedContact?.id === contact.id
                                            ? 'bg-blue-50 text-blue-700 font-medium'
                                            : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                            {contact.name.charAt(0)}
                                        </span>
                                        <span className="truncate">{contact.name}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* RIGHT: Chat area */}
                    <div className="flex-1 flex flex-col">
                        {selectedContact ? (
                            <>
                                {/* Chat header */}
                                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                                    <p className="font-semibold text-gray-900">{selectedContact.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {selectedContact.type === 'candidat' ? 'Candidat' : 'Membre JE'}
                                    </p>
                                </div>

                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {currentMessages.length === 0 ? (
                                        <div className="flex items-center justify-center h-full">
                                            <p className="text-gray-400 text-sm">Commencez la conversation&hellip;</p>
                                        </div>
                                    ) : (
                                        currentMessages.map(msg => (
                                            <div key={msg.id} className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
                                                    msg.isMine
                                                        ? 'bg-blue-600 text-white rounded-br-md'
                                                        : 'bg-gray-100 text-gray-900 rounded-bl-md'
                                                }`}>
                                                    <p>{msg.text}</p>
                                                    <p className={`text-xs mt-1 ${msg.isMine ? 'text-blue-200' : 'text-gray-400'}`}>
                                                        {formatTime(msg.timestamp)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Input */}
                                <div className="p-3 border-t border-gray-200 bg-white">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={inputValue}
                                            onChange={e => setInputValue(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            placeholder="Tapez votre message..."
                                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                        <button
                                            onClick={handleSend}
                                            disabled={!inputValue.trim()}
                                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            Envoyer
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center">
                                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                                        <span className="text-2xl text-gray-400">@</span>
                                    </div>
                                    <p className="text-gray-500 text-sm">S&eacute;lectionnez un contact pour commencer</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Member (non-admin) view: single chat with Admin
    const memberMessages = conversations['admin'] || [];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Messagerie priv&eacute;e</h1>
                <p className="text-sm text-gray-500 mt-1">Conversation priv&eacute;e avec l&apos;Admin AJC</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style={{ height: '600px' }}>
                {/* Chat header */}
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">A</span>
                        <div>
                            <p className="font-semibold text-gray-900">Admin AJC</p>
                            <p className="text-xs text-gray-500">Administrateur</p>
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {memberMessages.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <p className="text-gray-400 text-sm">Commencez la conversation&hellip;</p>
                        </div>
                    ) : (
                        memberMessages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
                                    msg.isMine
                                        ? 'bg-blue-600 text-white rounded-br-md'
                                        : 'bg-gray-100 text-gray-900 rounded-bl-md'
                                }`}>
                                    <p>{msg.text}</p>
                                    <p className={`text-xs mt-1 ${msg.isMine ? 'text-blue-200' : 'text-gray-400'}`}>
                                        {formatTime(msg.timestamp)}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-3 border-t border-gray-200 bg-white">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Tapez votre message..."
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!inputValue.trim()}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Envoyer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
