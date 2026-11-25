import { useSmartCapabilities } from "./smart-cellar-hooks";

/**
 * Whether this server says depth is open here (capabilities `depthPlacement`, Smart Cellar 3D sprint 9; ADR-011 §5).
 * The one place the screens read it. False while the answer is not there yet, and false wherever the server's depth
 * gate is closed (production, and everywhere by default): every screen then offers exactly what it offered before.
 * The capabilities are asked once a visit (the 3D cellar and the Builder have already asked), so this adds no request.
 */
export function useDepthOpen(): boolean {
  return useSmartCapabilities(true).data?.depthPlacement === true;
}
