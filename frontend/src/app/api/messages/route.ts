import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized } from '@/lib/auth';
import { NextRequest } from 'next/server';

// GET /api/messages - Fetch private messages for current user
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { data, error } = await supabaseAdmin
      .from('private_messages')
      .select('*')
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const messages = (data || []).map((m: any) => ({
      id: m.id,
      senderId: m.sender_id,
      senderRole: m.sender_role,
      senderName: m.sender_name,
      recipientId: m.recipient_id,
      recipientRole: m.recipient_role,
      text: m.message,
      read: m.read,
      createdAt: m.created_at,
      time: new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    }));

    return Response.json(messages);
  } catch (error) {
    console.error('Messages GET error:', error);
    return Response.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

// POST /api/messages - Send a private message
export async function POST(req: NextRequest) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();

  try {
    const { recipientId, recipientRole, message, senderName } = await req.json();

    if (!recipientId || !message?.trim()) {
      return Response.json({ error: 'recipientId and message are required' }, { status: 400 });
    }

    let role = 'member';
    if (user.role === 'candidate') role = 'candidate';
    else if (user.isAdmin) role = 'admin';

    const { data, error } = await supabaseAdmin
      .from('private_messages')
      .insert({
        sender_id: user.id,
        sender_role: role,
        sender_name: senderName || user.email.split('@')[0],
        recipient_id: recipientId,
        recipient_role: recipientRole || 'member',
        message: message.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      id: data.id,
      senderId: data.sender_id,
      senderRole: data.sender_role,
      senderName: data.sender_name,
      recipientId: data.recipient_id,
      recipientRole: data.recipient_role,
      text: data.message,
      read: data.read,
      createdAt: data.created_at,
      time: new Date(data.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    }, { status: 201 });
  } catch (error) {
    console.error('Messages POST error:', error);
    return Response.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
