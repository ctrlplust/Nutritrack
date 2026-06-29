import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type UserRole = "admin" | "user" | "guest";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const IS_HTTPS = typeof window !== "undefined" && window.location?.protocol === "https:";
const API_URL = process.env.EXPO_PUBLIC_API_URL
  || (process.env.EXPO_PUBLIC_DOMAIN
    ? `${IS_HTTPS ? "https" : "http"}://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "http://192.168.1.94:3000");

const KEYS = {
  token: "nutritrack_auth_token",
  user: "nutritrack_auth_user",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuth();
  }, []);

  async function loadAuth() {
    try {
      const [tokenStr, userStr] = await Promise.all([
        AsyncStorage.getItem(KEYS.token),
        AsyncStorage.getItem(KEYS.user),
      ]);
      if (tokenStr && userStr) {
        setToken(tokenStr);
        setUser(JSON.parse(userStr));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function persistAuth(newToken: string, newUser: User) {
    await Promise.all([
      AsyncStorage.setItem(KEYS.token, newToken),
      AsyncStorage.setItem(KEYS.user, JSON.stringify(newUser)),
    ]);
    setToken(newToken);
    setUser(newUser);
  }

  async function clearAuth() {
    await Promise.all([
      AsyncStorage.removeItem(KEYS.token),
      AsyncStorage.removeItem(KEYS.user),
    ]);
    setToken(null);
    setUser(null);
  }

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Error al iniciar sesión");
    }
    const data = await res.json();
    await persistAuth(data.token, data.user);
  }, []);

  const loginAsGuest = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error("Error al crear sesión de invitado");
    const data = await res.json();
    await persistAuth(data.token, data.user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    if (!token) throw new Error("No autenticado");
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Error al registrar");
    }
  }, [token]);

  const logout = useCallback(async () => {
    await clearAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, loginAsGuest, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
