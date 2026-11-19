"use client";
import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import type { PermissionCode } from "./permission-codes";

/**
 * What the signed-in account may do. `"unknown"` means the interface has not been
 * told (today there is no account-wide capabilities endpoint), so actions are shown
 * and the server decides. A set turns gating on everywhere with no code change.
 */
export type Capabilities = ReadonlySet<string> | "unknown";

const CapabilitiesContext = createContext<Capabilities>("unknown");

export function PermissionProvider(props: {
  capabilities: Capabilities;
  children: ReactNode;
}): ReactElement {
  return (
    <CapabilitiesContext.Provider value={props.capabilities}>
      {props.children}
    </CapabilitiesContext.Provider>
  );
}

export type PermissionState = "allowed" | "denied" | "server-checked";

/**
 * Combines the account-wide list with an optional record-level flag that the
 * server computed for one record. Either source saying "no" wins (fail closed);
 * with no information at all the action is shown and the server decides.
 * This only shapes the interface: PostgreSQL still enforces every request.
 */
export function permissionState(
  capabilities: Capabilities,
  code: PermissionCode,
  recordAllowed?: boolean,
): PermissionState {
  if (recordAllowed === false) return "denied";
  if (capabilities !== "unknown" && !capabilities.has(code)) return "denied";
  if (recordAllowed === true || capabilities !== "unknown") return "allowed";
  return "server-checked";
}

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}

export function usePermissionState(
  code: PermissionCode,
  recordAllowed?: boolean,
): PermissionState {
  return permissionState(useContext(CapabilitiesContext), code, recordAllowed);
}

/**
 * The one component for any action that creates, changes, verifies or withdraws.
 * It declares the permission code it depends on. When denied it is removed (the
 * default) or shown disabled; it never renders an enabled button for a denial.
 */
export function PermissionAction(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    code: PermissionCode;
    /** A flag the server computed for the record on screen, if it sent one. */
    recordAllowed?: boolean;
    whenDenied?: "hide" | "disable";
    children: ReactNode;
  },
): ReactElement | null {
  const {
    code,
    recordAllowed,
    whenDenied = "hide",
    children,
    ...button
  } = props;
  const state = usePermissionState(code, recordAllowed);
  if (state === "denied" && whenDenied === "hide") return null;
  const denied = state === "denied";
  return (
    <button
      {...button}
      disabled={denied || button.disabled}
      aria-disabled={denied ? true : undefined}
      data-permission-code={code}
      data-permission-state={state}
    >
      {children}
    </button>
  );
}
