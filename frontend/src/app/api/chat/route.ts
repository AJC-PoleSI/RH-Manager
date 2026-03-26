import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/chat - Fetch all chat messages
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw error;

    const messages = (data || []).map((m: any) => ({
      id: m.id,
      name: m.sender_name,
      text: m.message,
      time: new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      role: m.sender_role,
      senderId: m.sender_id,
      createdAt: m.created_at,
    }));

    return Response.json(messages);
  } catch (error) {
    console.error('Chat GET error:', error);
    return Response.json({ error: 'Failed to fetch chat messages' }, { status: 500 });
  }
}

// POST /api/chat - Send a chat message
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { message, senderName } = await req.json();

    if (!message?.trim()) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    let role = 'member';
    if (user.role === 'candidate') role = 'candidate';
    else if (user.isAdmin) role = 'admin';

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        sender_id: user.id,
        sender_role: role,
        sender_name: senderName || user.email.split('@')[0],
        message: message.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      id: data.id,
      name: data.sender_name,
      text: data.message,
      time: new Date(data.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      role: data.sender_role,
      senderId: data.sender_id,
      createdAt: data.created_at,
    }, { status: 201 });
  } catch (error) {
    console.error('Chat POST error:', error);
    return Response.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
