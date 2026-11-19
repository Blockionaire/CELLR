import "server-only";
import { validateRegistry, type ArchitectureView, type RepositoryInventory } from "@cellr/domain";
import inventory from "./inventory.generated.json";
import { ARCHITECTURE_REGISTRY } from "./registry";

/**
 * The Architecture Control Center's data (System Intelligence ADR-001): the curated register, the facts generated
 * from the repository and the register's validation against them. Static: it reads no database and no network, so
 * the map works whatever else is down. Callers check the admin session first (server/admin/service.ts).
 */
export function architectureView(): ArchitectureView {
  const inv = inventory as RepositoryInventory;
  return {
    registry: ARCHITECTURE_REGISTRY,
    inventory: inv,
    issues: validateRegistry(ARCHITECTURE_REGISTRY, inv),
  };
}
