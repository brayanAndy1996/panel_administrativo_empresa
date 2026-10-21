"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AccessPermission, RoleCode, RoleDto, UserDto } from "../../../contracts/access";
import { getAccessApi } from "../../lib/api/access";
import { useAccess } from "./access-provider";
import { AlertMessage, FieldError, PageContent, PermissionNotice, WorkspaceShell } from "./workspace-shell";

type DialogMode = "create" | "edit" | "roles" | "disable";
type FieldErrors = Record<string, string[]>;
const PAGE_SIZE = 20;

function isOwnerPermission(permissions: AccessPermission[]): boolean {
  return permissions.includes("plataforma.usuarios.ver");
}

function passwordError(value: string): string | null {
  const length = Array.from(value).length;
  if (length < 15) return "Usa al menos 15 caracteres.";
  if (length > 128) return "La contraseña no puede superar 128 caracteres.";
  return null;
}

function validLogin(login: string): boolean {
  return /^[a-z0-9._-]{3,64}$/.test(login);
}

function roleName(roles: RoleDto[], code: RoleCode): string {
  return roles.find((role) => role.code === code)?.name ?? code;
}

export function UsersPage() {
  const { state, refresh } = useAccess();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [selected, setSelected] = useState<UserDto | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [login, setLogin] = useState("");
  const [active, setActive] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<RoleCode[]>([]);
  const requestId = useRef(0);
  const canView = state.phase === "authenticated" && isOwnerPermission(state.session.permissions);
  const canManage = state.phase === "authenticated" && state.session.permissions.includes("plataforma.usuarios.gestionar");
  const canAssignRoles = state.phase === "authenticated" && state.session.permissions.includes("plataforma.roles.asignar");

  const load = useCallback(async (requestedPage = page) => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const api = getAccessApi();
    if (!api) {
      setLoading(false);
      setError("El acceso a usuarios no está disponible en esta versión.");
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [userResult, roleResult] = await Promise.all([
        api.users.list({ page: requestedPage, pageSize: PAGE_SIZE }),
        api.roles.list(),
      ]);
      if (currentRequest !== requestId.current) return;
      if (!userResult.ok) {
        if (userResult.error.code === "UNAUTHENTICATED") await refresh();
        setError(userResult.error.code === "FORBIDDEN" ? "No tienes permiso para administrar usuarios." : userResult.error.message);
        setUsers([]);
        return;
      }
      if (!roleResult.ok) {
        if (roleResult.error.code === "UNAUTHENTICATED") await refresh();
        setError(roleResult.error.message);
        setUsers([]);
        return;
      }
      setUsers(userResult.data.items);
      setPage(userResult.data.page);
      setTotal(userResult.data.total);
      setRoles(roleResult.data);
    } catch {
      if (currentRequest === requestId.current) setError("No se pudo cargar la lista local de usuarios. Intenta nuevamente.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [canView, page, refresh]);

  useEffect(() => { void load(page); }, [load, page]);

  function startCreate() {
    setSelected(null);
    setDisplayName("");
    setLogin("");
    setActive(true);
    setSelectedRoles([]);
    setFieldErrors({});
    setError("");
    setDialog("create");
  }

  function startEdit(user: UserDto) {
    setSelected(user);
    setDisplayName(user.displayName);
    setLogin(user.login);
    setActive(user.active);
    setFieldErrors({});
    setError("");
    setDialog("edit");
  }

  function startRoleAssignment(user: UserDto) {
    setSelected(user);
    setSelectedRoles(user.roleCodes);
    setFieldErrors({});
    setError("");
    setDialog("roles");
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setSelected(null);
    setError("");
    setFieldErrors({});
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = (form.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";
    const confirmation = (form.elements.namedItem("confirmation") as HTMLInputElement | null)?.value ?? "";
    const normalizedLogin = login.trim().toLowerCase();
    const errors: FieldErrors = {};
    const passwordProblem = passwordError(password);
    if (!normalizedLogin || !validLogin(normalizedLogin)) errors.login = ["Usa de 3 a 64 letras ASCII minúsculas, números, punto, guion o guion bajo."];
    if (!displayName.trim() || Array.from(displayName.trim()).length > 120) errors.displayName = ["Escribe un nombre de hasta 120 caracteres."];
    if (passwordProblem) errors.password = [passwordProblem];
    if (password !== confirmation) errors.confirmation = ["Las contraseñas no coinciden."];
    if (selectedRoles.length === 0) errors.roleCodes = ["Selecciona al menos un rol."];
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ""; });
      return;
    }
    const api = getAccessApi();
    if (!api) {
      setError("No se pudo contactar el backend local.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.users.create({ login: normalizedLogin, displayName: displayName.trim(), password, roleCodes: selectedRoles });
      form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ""; });
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        setError(result.error.message);
        setFieldErrors(result.error.fields ?? {});
        return;
      }
      form.reset();
      setDialog(null);
      setSelected(null);
      if (page !== 1) setPage(1);
      else await load(1);
    } catch {
      form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ""; });
      setError("No se pudo crear el usuario local. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const normalizedLogin = login.trim().toLowerCase();
    const normalizedName = displayName.trim();
    const errors: FieldErrors = {};
    if (!validLogin(normalizedLogin)) errors.login = ["Usa de 3 a 64 letras ASCII minúsculas, números, punto, guion o guion bajo."];
    if (!normalizedName || Array.from(normalizedName).length > 120) errors.displayName = ["Escribe un nombre de hasta 120 caracteres."];
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const api = getAccessApi();
    if (!api) {
      setError("No se pudo contactar el backend local.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.users.update({ id: selected.id, expectedVersion: selected.version, login: normalizedLogin, displayName: normalizedName, active });
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        setError(result.error.code === "CONFLICT" ? "El usuario cambió desde que abriste este formulario. Cierra y vuelve a editarlo." : result.error.message);
        setFieldErrors(result.error.fields ?? {});
        return;
      }
      setDialog(null);
      setSelected(null);
      await load(page);
    } catch {
      setError("No se pudo actualizar el usuario local. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles() {
    if (!selected) return;
    if (selectedRoles.length === 0) {
      setFieldErrors({ roleCodes: ["Selecciona al menos un rol."] });
      return;
    }
    if (state.phase === "authenticated" && selected.id === state.session.user.id && !window.confirm("Cambiar tus propios roles puede cerrar esta sesión. ¿Continuar?")) return;
    const api = getAccessApi();
    if (!api) {
      setError("No se pudo contactar el backend local.");
      return;
    }
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      const result = await api.roles.assign({ id: selected.id, expectedVersion: selected.version, roleCodes: selectedRoles });
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        setError(result.error.code === "CONFLICT" ? "El usuario cambió desde que abriste este formulario. Cierra y vuelve a asignar los roles." : result.error.message);
        setFieldErrors(result.error.fields ?? {});
        return;
      }
      setDialog(null);
      setSelected(null);
      await load(page);
    } catch {
      setError("No se pudieron asignar los roles. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
    if (!selected) return;
    if (state.phase === "authenticated" && selected.id === state.session.user.id && !window.confirm("Desactivar tu propia cuenta cerrará esta sesión. ¿Continuar?")) return;
    const api = getAccessApi();
    if (!api) {
      setError("No se pudo contactar el backend local.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.users.disable({ id: selected.id, expectedVersion: selected.version });
      if (!result.ok) {
        if (result.error.code === "UNAUTHENTICATED") await refresh();
        setError(result.error.code === "CONFLICT" ? "El usuario cambió. Actualiza la lista e intenta nuevamente." : result.error.message);
        return;
      }
      setDialog(null);
      setSelected(null);
      await load(page);
    } catch {
      setError("No se pudo desactivar el usuario local. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRole(code: RoleCode, checked: boolean) {
    setSelectedRoles((current) => checked ? [...new Set([...current, code])] : current.filter((item) => item !== code));
  }

  if (!canView) {
    return <WorkspaceShell><PageContent><div className="page-intro"><p className="eyebrow">Administración</p><h1>Usuarios del panel</h1></div><PermissionNotice>No tienes permiso para administrar usuarios.</PermissionNotice></PageContent></WorkspaceShell>;
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <WorkspaceShell>
      <PageContent>
        <div className="page-intro page-intro-row">
          <div><p className="eyebrow">Administración</p><h1>Usuarios del panel</h1><p>Gestiona identidades locales y sus roles. Los cambios se aplican al guardar.</p></div>
          {canManage && <button className="button button-primary" type="button" onClick={startCreate}>Nuevo usuario</button>}
        </div>
        <AlertMessage message={error} />
        <div className="table-card">
          {loading ? <p className="table-state" role="status">Cargando usuarios…</p> : users.length === 0 ? <p className="table-state">No hay usuarios para mostrar.</p> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Identificador</th><th>Nombre</th><th>Roles</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.login}</td><td>{user.displayName}</td>
                      <td>{user.roleCodes.map((code) => roleName(roles, code)).join(", ")}</td>
                      <td><span className={user.active ? "state-label state-active" : "state-label state-inactive"}>{user.active ? "Activo" : "Inactivo"}</span></td>
                      <td><div className="row-actions">
                        {canManage && <button className="text-button" type="button" onClick={() => startEdit(user)}>Editar</button>}
                        {canAssignRoles && <button className="text-button" type="button" onClick={() => startRoleAssignment(user)}>Asignar roles</button>}
                        {canManage && user.active && <button className="text-button text-danger" type="button" onClick={() => { setSelected(user); setError(""); setDialog("disable"); }}>Desactivar</button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination" aria-label="Paginación de usuarios">
            <span>{total} usuario{total === 1 ? "" : "s"}</span>
            <div><button className="button button-light" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>Anterior</button><span>Página {page} de {lastPage}</span><button className="button button-light" type="button" onClick={() => setPage((value) => Math.min(lastPage, value + 1))} disabled={page >= lastPage || loading}>Siguiente</button></div>
          </div>
        </div>

        {dialog && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
            {dialog === "create" && (
              <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="create-dialog-title">
                <h2 id="create-dialog-title">Crear usuario</h2>
                <form className="form-stack" noValidate onSubmit={(event) => void createUser(event)}>
                  <label>Nombre visible<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" aria-invalid={Boolean(fieldErrors.displayName)} /><FieldError messages={fieldErrors.displayName} /></label>
                  <label>Identificador de acceso<input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" maxLength={64} aria-invalid={Boolean(fieldErrors.login)} /><FieldError messages={fieldErrors.login} /></label>
                  <label>Contraseña inicial<input name="password" type="password" autoComplete="new-password" aria-label="Contraseña inicial" aria-invalid={Boolean(fieldErrors.password)} /><span className="field-hint">De 15 a 128 caracteres. Se permiten espacios.</span><FieldError messages={fieldErrors.password} /></label>
                  <label>Confirmar contraseña<input name="confirmation" type="password" autoComplete="new-password" aria-label="Confirmar contraseña" aria-invalid={Boolean(fieldErrors.confirmation)} /><FieldError messages={fieldErrors.confirmation} /></label>
                  <fieldset><legend>Roles</legend>{roles.map((role) => <label className="check-option" key={role.code}><input type="checkbox" checked={selectedRoles.includes(role.code)} onChange={(event) => toggleRole(role.code, event.target.checked)} />{role.name}</label>)}<FieldError messages={fieldErrors.roleCodes} /></fieldset>
                  <AlertMessage message={error} />
                  <div className="dialog-actions"><button className="button button-light" type="button" onClick={closeDialog} disabled={busy}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creando…" : "Crear usuario"}</button></div>
                </form>
              </section>
            )}
            {dialog === "edit" && selected && (
              <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
                <h2 id="edit-dialog-title">Editar usuario</h2>
                <form className="form-stack" noValidate onSubmit={(event) => void saveProfile(event)}>
                  <label>Nombre visible<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} aria-invalid={Boolean(fieldErrors.displayName)} /><FieldError messages={fieldErrors.displayName} /></label>
                  <label>Identificador de acceso<input value={login} onChange={(event) => setLogin(event.target.value)} maxLength={64} aria-invalid={Boolean(fieldErrors.login)} /><FieldError messages={fieldErrors.login} /></label>
                  <label className="check-option"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Cuenta activa</label>
                  <AlertMessage message={error} />
                  <div className="dialog-actions"><button className="button button-light" type="button" onClick={closeDialog} disabled={busy}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>
                </form>
              </section>
            )}
            {dialog === "roles" && selected && (
              <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="roles-dialog-title">
                <h2 id="roles-dialog-title">Asignar roles</h2>
                <p>Selecciona el conjunto completo de roles para {selected.login}.</p>
                <div className="form-stack">{roles.map((role) => <label className="check-option" key={role.code}><input type="checkbox" checked={selectedRoles.includes(role.code)} onChange={(event) => toggleRole(role.code, event.target.checked)} />{role.name}</label>)}<FieldError messages={fieldErrors.roleCodes} /><AlertMessage message={error} /><div className="dialog-actions"><button className="button button-light" type="button" onClick={closeDialog} disabled={busy}>Cancelar</button><button className="button button-primary" type="button" onClick={() => void saveRoles()} disabled={busy}>{busy ? "Guardando…" : "Guardar roles"}</button></div></div>
              </section>
            )}
            {dialog === "disable" && selected && (
              <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="disable-dialog-title">
                <h2 id="disable-dialog-title">Desactivar usuario</h2>
                <p>La cuenta de {selected.login} dejará de iniciar sesión. El historial se conserva.</p>
                <AlertMessage message={error} />
                <div className="dialog-actions"><button className="button button-light" type="button" onClick={closeDialog} disabled={busy}>Cancelar</button><button className="button button-danger" type="button" onClick={() => void confirmDisable()} disabled={busy}>{busy ? "Desactivando…" : "Confirmar desactivación"}</button></div>
              </section>
            )}
          </div>
        )}
      </PageContent>
    </WorkspaceShell>
  );
}
