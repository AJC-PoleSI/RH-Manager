-- Run this in Supabase SQL Editor to add chat, messages, and tours tables

-- Tours de recrutement
CREATE TABLE IF NOT EXISTS tours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_venir',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Chat général (visible par tous)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Messages privés
CREATE TABLE IF NOT EXISTS private_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  recipient_id UUID NOT NULL,
  recipient_role TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_private_messages_sender ON private_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_private_messages_recipient ON private_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_private_messages_created ON private_messages(created_at);

-- Insert default tours
INSERT INTO tours (name, status) VALUES ('Tour 1', 'a_venir') ON CONFLICT DO NOTHING;
INSERT INTO tours (name, status) VALUES ('Tour 2', 'a_venir') ON CONFLICT DO NOTHING;
INSERT INTO tours (name, status) VALUES ('Tour 3', 'a_venir') ON CONFLICT DO NOTHING;
