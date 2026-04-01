import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

// PUT /api/epreuves/[id] - Proxy to Express backend
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const body = await req.json();
    const token = req.headers.get('authorization') || '';

    const backendRes = await fetch(`${BACKEND_URL}/api/epreuves/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify(body),
    });

    const data = await backendRes.json().catch(() => ({}));

    if (!backendRes.ok) {
      return Response.json(
        data || { error: 'Backend error' },
        { status: backendRes.status }
      );
    }

    return Response.json(data);
  } catch (error) {
    console.error('Proxy PUT /epreuves/:id error:', error);
    return Response.json({ error: 'Failed to update epreuve' }, { status: 500 });
  }
}

// DELETE /api/epreuves/[id] - Proxy to Express backend
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getTokenFromRequest(req);
  if (!user) return unauthorized();
  if (!user.isAdmin) return forbidden();

  const { id } = params;

  try {
    const token = req.headers.get('authorization') || '';

    const backendRes = await fetch(`${BACKEND_URL}/api/epreuves/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': token,
      },
    });

    if (!backendRes.ok) {
      const data = await backendRes.json().catch(() => ({}));
      return Response.json(
        data || { error: 'Backend error' },
        { status: backendRes.status }
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Proxy DELETE /epreuves/:id error:', error);
    return Response.json({ error: 'Failed to delete epreuve' }, { status: 400 });
  }
}
