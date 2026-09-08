import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.clear();
        // Session expirée (JWT de 2h) ou invalide : sans cette redirection, la
        // page reste affichée comme si de rien n'était et chaque action de
        // l'utilisateur échoue silencieusement en 401, empilant des toasts
        // "Non autorise" incompréhensibles à chaque nouvel essai (cf. capture
        // du 08/09/2026 — clics répétés sur "Enregistrer mes disponibilités").
        // Navigation dure (pas de router.push) : on veut repartir d'un état
        // React totalement neuf, hors de tout composant déjà monté avec un
        // token périmé en mémoire.
        if (!window.location.pathname.startsWith("/login")) {
          window.location.href = "/login?session=expired";
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;
