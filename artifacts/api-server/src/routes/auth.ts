import { Router, type IRouter } from "express";
import { authenticateUser, registerUser, createGuestUser, signToken, getUserById, getAllUsers } from "../lib/auth";
import { authenticate, requireRole } from "../middleware/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Usuario y contraseña requeridos" });
    return;
  }
  const user = await authenticateUser(username, password);
  if (!user) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }
  const token = signToken(user);
  res.json({ token, user });
});

router.post("/auth/guest", (_req, res) => {
  const user = createGuestUser();
  const token = signToken(user);
  res.json({ token, user });
});

router.post("/auth/register", authenticate, requireRole("admin"), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Usuario y contraseña requeridos" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: "La contraseña debe tener al menos 4 caracteres" });
    return;
  }
  try {
    const user = await registerUser(username, password);
    res.status(201).json({ user });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al registrar usuario";
    res.status(409).json({ error: message });
  }
});

router.get("/auth/me", authenticate, (req, res) => {
  const user = getUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  res.json({ user });
});

router.get("/auth/users", authenticate, requireRole("admin"), (_req, res) => {
  const users = getAllUsers();
  res.json({ users });
});

export default router;
