"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  text: string;
  time: string;
  createdAt: string;
  isMine: boolean;
}

interface Contact {
  id: string;
  name: string;
  type: "candidat" | "membre";
}

export default function MessagesPage() {
  const { user, role } = useAuth();
  const isAdmin = role === "member" && user?.isAdmin;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch contacts (candidates + members)
  const fetchContacts = useCallback(async () => {
    try {
      const [candidatesRes, membersRes] = await Promise.all([
        api.get("/candidates?limit=100"),
        api.get("/members"),
      ]);

      const candidatContacts: Contact[] = (candidatesRes.data?.data || []).map(
        (c: any) => ({
          id: c.id,
          name: `${c.firstName || c.first_name || ""} ${c.lastName || c.last_name || ""}`.trim(),
          type: "candidat" as const,
        }),
      );

      const membreContacts: Contact[] = (membersRes.data || [])
        .map((m: any) => ({
          id: m.id,
          name: m.email.split("@")[0],
          type: "membre" as const,
        }))
        .filter((m: Contact) => m.id !== user?.id);

      setContacts([...candidatContacts, ...membreContacts]);
    } catch (e) {
      console.error("Failed to fetch contacts:", e);
    }
  }, [user?.id]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get("/messages");
      const msgs = (res.data || []).map((m: any) => ({
        ...m,
        isMine: m.senderId === user?.id,
      }));
      setAllMessages(msgs);
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchContacts();
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchContacts, fetchMessages]);

  // Filter messages for selected contact
  const currentMessages = selectedContact
    ? allMessages.filter(
        (m) =>
          m.senderId === selectedContact.id ||
          m.recipientId === selectedContact.id,
      )
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages.length]);

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedContact) return;

    const messageText = inputValue.trim();
    setInputValue("");

    // Optimistic update
    const tempMsg: Message = {
      id: Date.now().toString(),
      senderId: user?.id || "",
      senderName: user?.email?.split("@")[0] || "Moi",
      recipientId: selectedContact.id,
      text: messageText,
      time: new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAt: new Date().toISOString(),
      isMine: true,
    };
    setAllMessages((prev) => [...prev, tempMsg]);

    try {
      await api.post("/messages", {
        recipientId: selectedContact.id,
        recipientRole:
          selectedContact.type === "candidat" ? "candidate" : "member",
        message: messageText,
        senderName: user?.email?.split("@")[0] || "Moi",
      });
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const candidats = contacts.filter((c) => c.type === "candidat");
  const membres = contacts.filter((c) => c.type === "membre");

  // Admin view: split layout
  if (isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Messagerie</h1>
          <p className="text-sm text-gray-500 mt-1">
            Envoyez des messages aux candidats et membres
          </p>
        </div>

        <div
          className="bg-white rounded-xl shadow-sm border border-gray-200 flex overflow-hidden"
          style={{ height: "600px" }}
        >
          {/* LEFT SIDEBAR */}
          <div
            className="border-r border-gray-200 flex flex-col"
            style={{ width: "265px", minWidth: "265px" }}
          >
            <div className="p-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Contacts
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {candidats.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      Candidats
                    </p>
                  </div>
                  {candidats.map((contact) => (
                    <button
                      key={contact.id}
                      onClick={() => setSelectedContact(contact)}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                        selectedContact?.id === contact.id
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-gray-700 hover:bg-gray-50"
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
                </>
              )}

              {membres.length > 0 && (
                <>
                  <div className="px-3 pt-4 pb-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      Membres JE
                    </p>
                  </div>
                  {membres.map((contact) => (
                    <button
                      key={contact.id}
                      onClick={() => setSelectedContact(contact)}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                        selectedContact?.id === contact.id
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-gray-700 hover:bg-gray-50"
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
                </>
              )}

              {contacts.length === 0 && !loading && (
                <div className="px-3 py-8 text-center text-sm text-gray-400">
                  Aucun contact
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Chat area */}
          <div className="flex-1 flex flex-col">
            {selectedContact ? (
              <>
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <p className="font-semibold text-gray-900">
                    {selectedContact.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedContact.type === "candidat"
                      ? "Candidat"
                      : "Membre JE"}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {currentMessages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-gray-400 text-sm">
                        Commencez la conversation&hellip;
                      </p>
                    </div>
                  ) : (
                    currentMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.isMine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
                            msg.isMine
                              ? "bg-blue-600 text-white rounded-br-md"
                              : "bg-gray-100 text-gray-900 rounded-bl-md"
                          }`}
                        >
                          <p>{msg.text}</p>
                          <p
                            className={`text-xs mt-1 ${msg.isMine ? "text-blue-200" : "text-gray-400"}`}
                          >
                            {msg.time}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-3 border-t border-gray-200 bg-white">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
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
                  <p className="text-gray-500 text-sm">
                    S&eacute;lectionnez un contact pour commencer
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Member (non-admin) view: read-only messages from admin
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Messages</h1>
        <p className="text-sm text-gray-500 mt-1">
          Messages re&ccedil;us de l&apos;administration
        </p>
      </div>

      <div
        className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col"
        style={{ height: "600px" }}
      >
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
              A
            </span>
            <div>
              <p className="font-semibold text-gray-900">Admin AJC</p>
              <p className="text-xs text-gray-500">Administrateur</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {allMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">📭</span>
                </div>
                <p className="text-gray-400 text-sm">
                  Aucun message pour le moment.
                </p>
              </div>
            </div>
          ) : (
            allMessages.map((msg) => (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm bg-gray-100 text-gray-900 rounded-bl-md">
                  <p>{msg.text}</p>
                  <p className="text-xs mt-1 text-gray-400">
                    {msg.senderName} &bull; {msg.time}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Lecture seule — pas de champ de saisie */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400 text-center">
            Les messages sont envoy&eacute;s par l&apos;administration. Vous ne
            pouvez pas r&eacute;pondre.
          </p>
        </div>
      </div>
    </div>
  );
}
