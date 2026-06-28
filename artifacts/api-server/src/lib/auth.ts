import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "nutritrack-dev-secret-change-in-production";

export type UserRole = "admin" | "user" | "guest";

export interface User {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  createdAt: string;
}

export interface UserPublic {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

const users = new Map<string, User>();

export function seedAdmin() {
  const existing = Array.from(users.values()).find(u => u.role === "admin");
  if (existing) return;
  const hashed = bcrypt.hashSync("admin123", 10);
  const admin: User = {
    id: "admin-1",
    username: "admin",
    password: hashed,
    role: "admin",
    createdAt: new Date().toISOString(),
  };
  users.set(admin.id, admin);
}

export async function registerUser(username: string, password: string, role: UserRole = "user"): Promise<UserPublic> {
  if (Array.from(users.values()).some(u => u.username === username)) {
    throw new Error("El nombre de usuario ya existe");
  }
  const hashed = await bcrypt.hash(password, 10);
  const user: User = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    username,
    password: hashed,
    role,
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

export async function authenticateUser(username: string, password: string): Promise<UserPublic | null> {
  const user = Array.from(users.values()).find(u => u.username === username);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

export function createGuestUser(): UserPublic {
  const id = "guest-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const guest: User = {
    id,
    username: "Invitado",
    password: "",
    role: "guest",
    createdAt: new Date().toISOString(),
  };
  users.set(guest.id, guest);
  return { id: guest.id, username: guest.username, role: "guest", createdAt: guest.createdAt };
}

export function signToken(user: UserPublic): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string): { id: string; username: string; role: UserRole } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: UserRole };
  } catch {
    return null;
  }
}

export function getUserById(id: string): UserPublic | null {
  const user = users.get(id);
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

export function getAllUsers(): UserPublic[] {
  return Array.from(users.values())
    .filter(u => u.role !== "guest")
    .map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
}
