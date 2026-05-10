"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  time: string;
  createdAt: string;
}

export default function CandidateMessagesPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get("/messages");
      setMessages(res.data || []);
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
        {/* Header */}
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

        {/* Messages (lecture seule) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          ) : messages.length === 0 ? (
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
            messages.map((msg) => (
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

        {/* Pas de champ de saisie — lecture seule */}
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
