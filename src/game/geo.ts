import type { Geometry, Position } from "geojson";

const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const DIRECTIONS = ["norr", "nordost", "öster", "sydost", "söder", "sydväst", "väster", "nordväst"];

// Riktningen från punkt 1 till punkt 2, som i "söder om".
export function directionWord(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return DIRECTIONS[Math.round(bearing / 45) % 8];
}

export const normalizeLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

const inRing = (x: number, y: number, ring: Position[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const inPolygon = (x: number, y: number, rings: Position[][]) =>
  inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));

export function pointInGeometry(lon: number, lat: number, geometry: Geometry): boolean {
  if (geometry.type === "Polygon") return inPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((p) => inPolygon(lon, lat, p));
  return false;
}
