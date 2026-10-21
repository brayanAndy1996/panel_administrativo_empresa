"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AccessApi, SessionView } from "../../../contracts/access";
import { DESKTOP_REQUIRED_MESSAGE, getAccessApi } from "../../lib/api/access";

export type AccessState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | { phase: "anonymous"; bootstrapRequired: boolean }
  | { phase: "authenticated"; session: SessionView };

interface AccessContextValue {
  state: AccessState;
  refresh(): Promise<void>;
  acceptSession(session: SessionView): void;
}

const AccessContext = createContext<AccessContextValue | null>(null);

function safeMessage(message: string): string {
  return message === DESKTOP_REQUIRED_MESSAGE
    ? DESKTOP_REQUIRED_MESSAGE
    : "No se pudo verificar el acceso local. Intenta nuevamente.";
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>({ phase: "loading" });
  const stateRef = useRef<AccessState>({ phase: "loading" });
  const generation = useRef(0);

  const commit = useCallback((next: AccessState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    const currentGeneration = ++generation.current;
    const commitIfCurrent = (next: AccessState) => {
      if (generation.current === currentGeneration) commit(next);
    };
    const api = getAccessApi();
    if (!api) {
      const hasPreload = typeof window !== "undefined" && Boolean(window.panel);
      commitIfCurrent({
        phase: "unavailable",
        message: hasPreload
          ? "El módulo de acceso no está disponible en esta versión de la aplicación."
          : DESKTOP_REQUIRED_MESSAGE,
      });
      return;
    }

    try {
      const status = await api.auth.status();
      if (!status.ok) {
        commitIfCurrent({ phase: "unavailable", message: safeMessage(status.error.message) });
        return;
      }

      if (status.data.bootstrapRequired) {
        commitIfCurrent({ phase: "anonymous", bootstrapRequired: true });
        return;
      }

      const session = await api.auth.me();
      if (session.ok) {
        commitIfCurrent({ phase: "authenticated", session: session.data });
        return;
      }
      if (session.error.code === "UNAUTHENTICATED") {
        commitIfCurrent({ phase: "anonymous", bootstrapRequired: false });
        return;
      }
      commitIfCurrent({ phase: "unavailable", message: safeMessage(session.error.message) });
    } catch {
      commitIfCurrent({ phase: "unavailable", message: "No se pudo verificar el acceso local. Intenta nuevamente." });
    }
  }, [commit]);

  const acceptSession = useCallback((session: SessionView) => {
    generation.current += 1;
    commit({ phase: "authenticated", session });
  }, [commit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (state.phase !== "authenticated") return;
    const api: AccessApi | null = getAccessApi();
    if (!api) return;
    let lastTouchAt = Date.now();

    const sessionUserId = state.session.user.id;
    const touchForUserActivity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastTouchAt < 30_000) return;
      lastTouchAt = now;
      const requestGeneration = generation.current;
      void api.auth.touch().then((result) => {
        if (generation.current !== requestGeneration) return;
        const current = stateRef.current;
        if (current.phase !== "authenticated" || current.session.user.id !== sessionUserId) return;
        if (result.ok) {
          commit({ phase: "authenticated", session: result.data });
        } else if (result.error.code === "UNAUTHENTICATED") {
          commit({ phase: "anonymous", bootstrapRequired: false });
        }
      }).catch(() => undefined);
    };

    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const eventName of events) window.addEventListener(eventName, touchForUserActivity, { passive: true });
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, touchForUserActivity);
    };
  }, [commit, state]);

  useEffect(() => {
    if (state.phase !== "authenticated") return;
    const api = getAccessApi();
    if (!api) return;
    const sessionUserId = state.session.user.id;
    const deadline = Math.min(Date.parse(state.session.expiresAt), Date.parse(state.session.idleExpiresAt));
    const delay = Math.max(0, deadline - Date.now());
    const expectedGeneration = generation.current;
    const timer = window.setTimeout(() => {
      if (generation.current !== expectedGeneration) return;
      const current = stateRef.current;
      if (current.phase !== "authenticated" || current.session.user.id !== sessionUserId) return;
      void api.auth.me().then((result) => {
        if (generation.current !== expectedGeneration) return;
        const latest = stateRef.current;
        if (latest.phase !== "authenticated" || latest.session.user.id !== sessionUserId) return;
        if (!result.ok) {
          if (result.error.code === "UNAUTHENTICATED") {
            generation.current += 1;
            commit({ phase: "anonymous", bootstrapRequired: false });
          } else {
            commit({ phase: "unavailable", message: "No se pudo verificar el acceso local. Intenta nuevamente." });
          }
          return;
        }
        const nextDeadline = Math.min(Date.parse(result.data.expiresAt), Date.parse(result.data.idleExpiresAt));
        if (nextDeadline <= Date.now()) {
          generation.current += 1;
          commit({ phase: "anonymous", bootstrapRequired: false });
          return;
        }
        commit({ phase: "authenticated", session: result.data });
      }).catch(() => {
        if (generation.current === expectedGeneration) {
          commit({ phase: "unavailable", message: "No se pudo verificar el acceso local. Intenta nuevamente." });
        }
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [commit, state]);

  const value = useMemo(() => ({ state, refresh, acceptSession }), [state, refresh, acceptSession]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error("AccessProvider is missing.");
  return value;
}

export function AccessRouteGuard({ children }: { children: ReactNode }) {
  const { state, refresh } = useAccess();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const isAccessRoute = pathname.replace(/\/+$/, "") === "/acceso";

  useEffect(() => {
    if (state.phase === "loading" || state.phase === "unavailable") return;
    if (state.phase === "authenticated" && isAccessRoute) router.replace("/");
    if (state.phase === "anonymous" && !isAccessRoute) router.replace("/acceso/");
  }, [isAccessRoute, router, state]);

  if (state.phase === "loading") {
    return <main className="access-gate" role="status" aria-busy="true">Verificando el acceso local…</main>;
  }
  if (state.phase === "unavailable") {
    return (
      <main className="access-gate" role="alert">
        <h1>Acceso no disponible</h1>
        <p>{state.message}</p>
        <button className="button button-primary" type="button" onClick={() => void refresh()}>
          Reintentar
        </button>
      </main>
    );
  }
  if (state.phase === "authenticated" && isAccessRoute) {
    return <main className="access-gate" role="status">Sesión activa. Abriendo el panel…</main>;
  }
  if (state.phase === "anonymous" && !isAccessRoute) {
    return <main className="access-gate" role="status">Abriendo la pantalla de acceso…</main>;
  }
  return children;
}
