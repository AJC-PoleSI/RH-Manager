import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const backendRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await backendRes.json().catch(() => ({}));
    return Response.json(data, { status: backendRes.status });
  } catch (error) {
    console.error('Login proxy error:', error);
    return Response.json({ error: 'Erreur de connexion. Le serveur est inaccessible.' }, { status: 500 });
  }
}
