// Script de connexion rapide pour tester l'app
// Utilisez dans la console du navigateur sur http://localhost:3000

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhNmNiMjlmOS1hNDFlLTQ4YTEtOGVkMy03ZDZkZDQ3MTg3ZGIiLCJpc0FkbWluIjp0cnVlLCJpYXQiOjE3NzUwMzEwOTMsImV4cCI6MTc3NTExNzQ5M30.Mso8Odx63XV5NOiceR9S2OUotHG7z_WraDyFwulFGto";

localStorage.setItem('token', token);
localStorage.setItem('user', JSON.stringify({
  id: 'a6cb29f9-a41e-48a1-8ed3-7d6dd47187db',
  email: 'admin@rhmanager.com',
  isAdmin: true
}));
localStorage.setItem('role', 'member');

console.log('✅ Connecté en tant qu\'admin');
window.location.href = '/dashboard/settings';
