"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  email: string;
  type: "candidat" | "membre";
}

/**
 * Clé de recherche : minuscules et sans accents.
 * Sans ça, chercher « zoe » ne trouve pas « Zoé » — le cas le plus courant
 * dans une liste de prénoms français.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Le contact correspond-il à la recherche ? (nom OU email, mots dans le désordre) */
function matchesQuery(contact: Contact, query: string): boolean {
  const haystack = normalize(`${contact.name} ${contact.email}`);
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export default function MessagesPage() {
  const { user, role } = useAuth();
  const isAdmin = role === "member" && user?.isAdmin;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch contacts (candidates + members)
  const fetchContacts = useCallback(async () => {
    try {
      const [candidateRows, membersRes] = await Promise.all([
        // La liste des candidats est paginée côté API : sans cette boucle,
        // seuls les 100 premiers candidats étaient joignables — les suivants
        // n'apparaissaient dans aucune recherche.
        (async () => {
          const rows: any[] = [];
          let page = 1;
          let totalPages = 1;
          do {
            const res = await api.get(`/candidates?limit=200&page=${page}`);
            rows.push(...(res.data?.data || []));
            totalPages = res.data?.pagination?.totalPages ?? 1;
            page++;
          } while (page <= totalPages && page <= 20);
          return rows;
        })(),
        api.get("/members"),
      ]);

      const candidatContacts: Contact[] = candidateRows.map((c: any) => ({
        id: c.id,
        name:
          `${c.firstName || c.first_name || ""} ${c.lastName || c.last_name || ""}`.trim() ||
          c.email ||
          "Candidat",
        email: c.email || "",
        type: "candidat" as const,
      }));

      const membreContacts: Contact[] = (membersRes.data || [])
        .map((m: any) => ({
          id: m.id,
          // Le nom réel quand il est renseigné : « marie.dupont » ne dit pas
          // toujours à qui on écrit.
          name:
            `${m.firstName || ""} ${m.lastName || ""}`.trim() ||
            m.email.split("@")[0],
          email: m.email || "",
          type: "membre" as const,
        }))
        .filter((m: Contact) => m.id !== user?.id);

      const byName = (a: Contact, b: Contact) =>
        a.name.localeCompare(b.name, "fr");

      setContacts([
        ...candidatContacts.sort(byName),
        ...membreContacts.sort(byName),
      ]);
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

  // La zone de saisie grandit avec le texte (jusqu'à ~6 lignes) puis
  // devient scrollable : un message multi-lignes doit rester lisible
  // pendant qu'on l'écrit, sans manger toute la conversation.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputValue, selectedContact]);

  const handleSend = async () => {
    if (!inputValue.trim() || !selectedContact || sending) return;

    const messageText = inputValue.trim();
    const recipient = selectedContact;
    setInputValue("");
    setNotice(null);
    setSending(true);

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const tempMsg: Message = {
      id: tempId,
      senderId: user?.id || "",
      senderName: user?.email?.split("@")[0] || "Moi",
      recipientId: recipient.id,
      text: messageText,
      time: new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAt: new Date().toISOString(),
      isMine: true,
    };
    setAllMessages((prev) => [...prev, tempMsg]);

    const wantsEmail = alsoEmail && !!recipient.email;

    try {
      const res = await api.post("/messages", {
        recipientId: recipient.id,
        message: messageText,
        sendEmail: wantsEmail,
      });

      // Le message provisoire est remplacé par celui du serveur : sinon il
      // reste affiché en double jusqu'au prochain rafraîchissement.
      setAllMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...res.data, isMine: true } : m,
        ),
      );

      if (wantsEmail) {
        setNotice(
          res.data?.emailSent
            ? { kind: "ok", text: `Message envoyé et email parti à ${recipient.email}.` }
            : {
                kind: "error",
                text: `Message envoyé, mais l'email n'est pas parti${
                  res.data?.emailError ? ` : ${res.data.emailError}` : ""
                }.`,
              },
        );
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setAllMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputValue(messageText);
      setNotice({ kind: "error", text: "Échec de l'envoi du message." });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Entrée envoie ; Maj/Alt/Ctrl + Entrée saute une ligne.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const { candidats, membres, totalFiltres } = useMemo(() => {
    const filtered = search.trim()
      ? contacts.filter((c) => matchesQuery(c, search))
      : contacts;
    return {
      candidats: filtered.filter((c) => c.type === "candidat"),
      membres: filtered.filter((c) => c.type === "membre"),
      totalFiltres: filtered.length,
    };
  }, [contacts, search]);

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

        {/* Sur mobile la messagerie n'a pas la place d'afficher deux colonnes :
            on montre la liste OU la conversation, avec un retour explicite. */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex overflow-hidden h-[calc(100dvh-15rem)] min-h-[420px] md:h-[600px]">
          {/* LEFT SIDEBAR */}
          <div
            className={`border-r border-gray-200 flex-col w-full md:w-[265px] md:min-w-[265px] ${
              selectedContact ? "hidden md:flex" : "flex"
            }`}
          >
            <div className="p-3 border-b border-gray-100 bg-gray-50 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Contacts
                </p>
                <span className="text-xs text-gray-400">
                  {search.trim()
                    ? `${totalFiltres}/${contacts.length}`
                    : contacts.length || ""}
                </span>
              </div>
              {/* Recherche : la liste dépasse vite la centaine de contacts,
                  faire défiler pour trouver une personne n'est pas tenable. */}
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                  />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un contact..."
                  aria-label="Rechercher un contact"
                  className="w-full pl-8 pr-8 py-2 min-h-[40px] bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent [&::-webkit-search-cancel-button]:appearance-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Effacer la recherche"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
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
                      className={`w-full text-left px-3 py-2.5 min-h-[48px] text-sm transition-colors ${
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
                      className={`w-full text-left px-3 py-2.5 min-h-[48px] text-sm transition-colors ${
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

              {totalFiltres === 0 && contacts.length > 0 && (
                <div className="px-3 py-8 text-center text-sm text-gray-400">
                  Aucun contact ne correspond à
                  <br />
                  <span className="font-medium text-gray-600">
                    &laquo; {search.trim()} &raquo;
                  </span>
                </div>
              )}

              {contacts.length === 0 && !loading && (
                <div className="px-3 py-8 text-center text-sm text-gray-400">
                  Aucun contact
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Chat area */}
          <div
            className={`flex-1 flex-col min-w-0 ${
              selectedContact ? "flex" : "hidden md:flex"
            }`}
          >
            {selectedContact ? (
              <>
                <div className="px-3 md:px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
                  <button
                    onClick={() => setSelectedContact(null)}
                    className="md:hidden -ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                    aria-label="Retour aux contacts"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {selectedContact.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {selectedContact.type === "candidat"
                        ? "Candidat"
                        : "Membre JE"}
                      {selectedContact.email
                        ? ` · ${selectedContact.email}`
                        : " · aucune adresse email"}
                    </p>
                  </div>
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
                          className={`max-w-[85%] sm:max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm break-words ${
                            msg.isMine
                              ? "bg-blue-600 text-white rounded-br-md"
                              : "bg-gray-100 text-gray-900 rounded-bl-md"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.text}</p>
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

                <div className="p-3 border-t border-gray-200 bg-white space-y-2">
                  {notice && (
                    <p
                      className={`text-xs ${
                        notice.kind === "ok"
                          ? "text-green-600"
                          : "text-amber-600"
                      }`}
                    >
                      {notice.text}
                    </p>
                  )}
                  <div className="flex gap-2 items-end">
                    <textarea
                      ref={textareaRef}
                      rows={2}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Tapez votre message... (Maj + Entrée pour aller à la ligne)"
                      className="flex-1 min-w-0 px-4 py-2 min-h-[72px] max-h-40 resize-none overflow-y-auto border border-gray-300 rounded-lg text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!inputValue.trim() || sending}
                      className="shrink-0 px-4 py-2 min-h-[44px] bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {sending ? "Envoi..." : "Envoyer"}
                    </button>
                  </div>
                  {/* Doublon email : la messagerie in-app ne notifie personne,
                      un candidat qui ne se reconnecte pas ne voit jamais le
                      message. Décochable — le quota Resend est de 100/jour. */}
                  <label
                    className={`flex items-center gap-2 text-xs ${
                      selectedContact.email
                        ? "text-gray-600 cursor-pointer"
                        : "text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={alsoEmail && !!selectedContact.email}
                      disabled={!selectedContact.email}
                      onChange={(e) => setAlsoEmail(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {selectedContact.email
                      ? "Envoyer aussi par email"
                      : "Envoi email impossible (pas d'adresse)"}
                  </label>
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[calc(100dvh-15rem)] min-h-[420px] md:h-[600px]">
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
                <div className="max-w-[85%] sm:max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm break-words bg-gray-100 text-gray-900 rounded-bl-md">
                  <p className="whitespace-pre-wrap">{msg.text}</p>
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
